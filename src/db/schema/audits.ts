import { sql } from "drizzle-orm";
import { check, date, index, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { assets } from "./assets.js";
import { clients } from "./clients.js";
import { users } from "./users.js";

export const AUDIT_STATUSES = ["scheduled", "in_progress", "completed"] as const;

export const audits = pgTable(
  "audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    leadUserId: uuid("lead_user_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 200 }).notNull(),
    projectReference: varchar("project_reference", { length: 100 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("scheduled"),
    description: text("description"),
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audits_client_id_idx").on(table.clientId),
    index("audits_lead_user_id_idx").on(table.leadUserId),
    check("audits_status_check", sql`${table.status} IN ('scheduled', 'in_progress', 'completed')`),
    check(
      "audits_due_date_check",
      sql`${table.dueDate} IS NULL OR ${table.startDate} IS NULL OR ${table.dueDate} >= ${table.startDate}`,
    ),
  ],
);

export const auditAssets = pgTable(
  "audit_assets",
  {
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.auditId, table.assetId] }), index("audit_assets_asset_id_idx").on(table.assetId)],
);
