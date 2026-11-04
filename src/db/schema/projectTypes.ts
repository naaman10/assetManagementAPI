import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const projectTypes = pgTable(
  "project_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    focus: varchar("focus", { length: 30 }).notNull().default("assets"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("project_types_code_unique").on(table.code),
    check(
      "project_types_focus_check",
      sql`${table.focus} IN ('assets', 'sites_locations')`,
    ),
  ],
);
