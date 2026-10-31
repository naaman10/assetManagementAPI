import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

export const auditStorage = new AsyncLocalStorage<Database>();

export type AuditActor = {
  id: string;
  email: string;
  name: string | null;
};

export async function withAuditedConnection<T>(pool: Pool, actor: AuditActor, fn: () => Promise<T>): Promise<T> {
  if (auditStorage.getStore()) {
    return fn();
  }

  const client = await pool.connect();
  const audited = drizzle({ client, schema });

  try {
    await setActor(client, actor);
    return await auditStorage.run(audited, fn);
  } finally {
    let destroy = false;

    try {
      await clearActor(client);
    } catch {
      destroy = true;
    }

    client.release(destroy);
  }
}

async function setActor(client: PoolClient, actor: AuditActor) {
  await client.query(
    `select
      set_config('app.actor_user_id', $1, false),
      set_config('app.actor_email', $2, false),
      set_config('app.actor_name', $3, false),
      set_config('app.request_id', $4, false)`,
    [actor.id, actor.email, actor.name ?? "", randomUUID()],
  );
}

async function clearActor(client: PoolClient) {
  await client.query(
    `select
      set_config('app.actor_user_id', '', false),
      set_config('app.actor_email', '', false),
      set_config('app.actor_name', '', false),
      set_config('app.request_id', '', false)`,
  );
}
