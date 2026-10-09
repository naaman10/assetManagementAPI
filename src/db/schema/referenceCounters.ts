import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, uuid, varchar } from "drizzle-orm/pg-core";
import { clients } from "./clients.js";

export const REFERENCE_KINDS = ["MS", "WO", "MH"] as const;

export const referenceCounters = pgTable(
  "reference_counters",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 2 }).notNull(),
    value: integer("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clientId, table.kind] }),
    check("reference_counters_kind_check", sql`${table.kind} IN ('MS', 'WO', 'MH')`),
    check("reference_counters_value_check", sql`${table.value} > 0`),
  ],
);
