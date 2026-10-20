import { sql } from "drizzle-orm";
import { check, date, index, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { assets } from "./assets.js";
import { clients } from "./clients.js";
import { projectTypes } from "./projectTypes.js";
import { users } from "./users.js";

export const PROJECT_STATUSES = ["scheduled", "in_progress", "completed"] as const;

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    projectTypeId: uuid("project_type_id")
      .notNull()
      .references(() => projectTypes.id, { onDelete: "restrict" }),
    leadUserId: uuid("lead_user_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 200 }).notNull(),
    projectReference: varchar("project_reference", { length: 100 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("scheduled"),
    description: text("description"),
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_client_id_idx").on(table.clientId),
    index("projects_project_type_id_idx").on(table.projectTypeId),
    index("projects_lead_user_id_idx").on(table.leadUserId),
    check("projects_status_check", sql`${table.status} IN ('scheduled', 'in_progress', 'completed')`),
    check(
      "projects_due_date_check",
      sql`${table.dueDate} IS NULL OR ${table.startDate} IS NULL OR ${table.dueDate} >= ${table.startDate}`,
    ),
  ],
);

export const projectAssets = pgTable(
  "project_assets",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.assetId] }),
    index("project_assets_asset_id_idx").on(table.assetId),
  ],
);
