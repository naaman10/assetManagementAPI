import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient, QueryResult } from "pg";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

export type AuditActor = {
  id: string;
  email: string;
  name: string | null;
};

type AuditStore = {
  db: Database;
  actor: AuditActor;
  requestId: string;
};

type QueryCall = (query: unknown, values?: unknown) => Promise<QueryResult>;

type AuditBinding = {
  rollback(): Promise<void>;
};

// Neon's pooled endpoint keeps a Postgres backend for a single transaction and
// then discards session state. The audit trigger reads app.actor_* and
// app.request_id on the connection that runs the write, so those settings have
// to be applied with set_config(..., true) inside that same transaction.
export const auditStorage = new AsyncLocalStorage<AuditStore>();

const bindings = new WeakMap<PoolClient, AuditBinding>();
const patchedPools = new WeakSet<Pool>();

const actorSettingsSql = `select
  set_config('app.actor_user_id', $1, true),
  set_config('app.actor_email', $2, true),
  set_config('app.actor_name', $3, true),
  set_config('app.request_id', $4, true)`;

export async function withAuditedConnection<T>(pool: Pool, actor: AuditActor, fn: () => Promise<T>): Promise<T> {
  if (auditStorage.getStore()) {
    return fn();
  }

  ensureAuditPool(pool);
  const client = await pool.connect();
  const binding = bindAuditActor(client);
  const audited = drizzle({ client, schema });
  const requestId = randomUUID();

  try {
    return await auditStorage.run({ db: audited, actor, requestId }, fn);
  } finally {
    let destroy = false;

    try {
      await binding.rollback();
    } catch {
      destroy = true;
    }

    client.release(destroy);
  }
}

function ensureAuditPool(pool: Pool) {
  if (patchedPools.has(pool)) return;
  patchedPools.add(pool);

  const connect = pool.connect.bind(pool) as (
    callback?: (error: Error | undefined, client: PoolClient, done: () => void) => void,
  ) => Promise<PoolClient> | void;

  pool.connect = ((callback?: (error: Error | undefined, client: PoolClient, done: () => void) => void) => {
    if (typeof callback === "function") {
      return connect((error, client, done) => {
        if (client) bindAuditActor(client);
        callback(error, client, done);
      });
    }

    return Promise.resolve(connect() as Promise<PoolClient>).then((client) => {
      bindAuditActor(client);
      return client;
    });
  }) as Pool["connect"];
}

function bindAuditActor(client: PoolClient): AuditBinding {
  const existing = bindings.get(client);
  if (existing) return existing;

  const original = client.query.bind(client) as QueryCall;
  const exclusive = serialize();
  const state = { depth: 0 };
  const binding: AuditBinding = {
    async rollback() {
      if (state.depth === 0) return;
      await original("rollback");
      state.depth = 0;
    },
  };

  client.query = ((config: unknown, values?: unknown, callback?: unknown) => {
    const normalized = normalizeQuery(config, values, callback);
    const store = auditStorage.getStore();
    const promise = exclusive(() => runQuery(original, state, store, normalized.config, normalized.values));

    if (normalized.callback) {
      promise.then(
        (result) => normalized.callback?.(undefined, result),
        (error: unknown) => normalized.callback?.(error),
      );
    }

    return promise;
  }) as PoolClient["query"];

  bindings.set(client, binding);
  return binding;
}

async function runQuery(
  original: QueryCall,
  state: { depth: number },
  store: AuditStore | undefined,
  config: unknown,
  values: unknown,
): Promise<QueryResult> {
  if (!store) return invoke(original, config, values);

  const text = queryText(config);
  const kind = statementKind(text);

  if (kind === "begin") {
    const result = await invoke(original, config, values);
    state.depth += 1;

    if (state.depth === 1) {
      try {
        await applyActor(original, store);
      } catch (error) {
        state.depth -= 1;
        try {
          await original("rollback");
        } catch {
          // The connection is already unusable.
        }
        throw error;
      }
    }

    return result;
  }

  if (kind === "commit" || kind === "rollback") {
    try {
      return await invoke(original, config, values);
    } finally {
      state.depth = Math.max(0, state.depth - 1);
    }
  }

  if (state.depth > 0 || !isMutation(text)) {
    return invoke(original, config, values);
  }

  await original("begin");
  state.depth = 1;

  try {
    await applyActor(original, store);
    const result = await invoke(original, config, values);
    await original("commit");
    state.depth = 0;
    return result;
  } catch (error) {
    state.depth = 0;
    try {
      await original("rollback");
    } catch {
      // The connection is already unusable.
    }
    throw error;
  }
}

function applyActor(query: QueryCall, store: AuditStore) {
  return query(actorSettingsSql, [store.actor.id, store.actor.email, store.actor.name ?? "", store.requestId]);
}

function normalizeQuery(config: unknown, values: unknown, callback: unknown) {
  if (typeof values === "function") {
    return { config, values: undefined, callback: values as QueryCallback };
  }

  return {
    config,
    values,
    callback: typeof callback === "function" ? (callback as QueryCallback) : undefined,
  };
}

type QueryCallback = (error: unknown, result?: QueryResult) => void;

async function invoke(query: QueryCall, config: unknown, values: unknown) {
  if (values === undefined) return query(config);
  return query(config, values);
}

function queryText(config: unknown) {
  if (typeof config === "string") return config;
  if (config && typeof config === "object" && "text" in config && typeof config.text === "string") {
    return config.text;
  }
  return "";
}

function statementKind(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/;$/, "");
  if (normalized === "begin" || normalized.startsWith("begin ")) return "begin";
  if (normalized === "commit" || normalized.startsWith("commit ")) return "commit";
  if (normalized.startsWith("rollback to ")) return "other";
  if (normalized === "rollback" || normalized.startsWith("rollback ")) return "rollback";
  return "other";
}

function isMutation(text: string) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(insert|update|delete|merge|truncate)\b/.test(normalized)) return true;
  if (!normalized.startsWith("with ")) return false;
  return /\b(insert|update|delete|merge|truncate)\b/.test(normalized);
}

function serialize() {
  let chain = Promise.resolve();

  return function exclusive<T>(task: () => Promise<T>) {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
