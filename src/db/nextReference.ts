import { eq, sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type * as schema from "./schema/index.js";
import { clients, referenceCounters } from "./schema/index.js";
import type { Database } from "./types.js";

export type ReferenceKind = "MS" | "WO" | "MH";

type ReferenceDb =
  | Database
  | PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export async function nextReference(db: ReferenceDb, clientId: string, kind: ReferenceKind) {
  const [client] = await db.select({ reference: clients.reference }).from(clients).where(eq(clients.id, clientId)).limit(1);

  if (!client) {
    throw new Error("Client was not found for a reference number.");
  }

  const [counter] = await db
    .insert(referenceCounters)
    .values({ clientId, kind, value: 1 })
    .onConflictDoUpdate({
      target: [referenceCounters.clientId, referenceCounters.kind],
      set: { value: sql`${referenceCounters.value} + 1` },
    })
    .returning({ value: referenceCounters.value });

  if (!counter) {
    throw new Error("Reference number was not created.");
  }

  return `${client.reference}-${kind}-${counter.value}`;
}
