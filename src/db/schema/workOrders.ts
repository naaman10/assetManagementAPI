import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { assets } from "./assets.js";
import { maintenanceSchedules } from "./maintenanceSchedules.js";
import { maintenanceTypes } from "./maintenanceTypes.js";
import { users } from "./users.js";

export const WORK_ORDER_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const WORK_ORDER_STATUSES = ["open", "scheduled", "in_progress", "on_hold", "completed", "cancelled"] as const;

export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id").references(() => maintenanceSchedules.id, { onDelete: "set null" }),
    maintenanceTypeId: uuid("maintenance_type_id")
      .notNull()
      .references(() => maintenanceTypes.id, { onDelete: "restrict" }),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    priority: varchar("priority", { length: 30 }).notNull().default("medium"),
    status: varchar("status", { length: 30 }).notNull().default("open"),
    dueDate: date("due_date", { mode: "string" }),
    scheduledDate: date("scheduled_date", { mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("work_orders_asset_id_idx").on(table.assetId),
    index("work_orders_schedule_id_idx").on(table.scheduleId),
    index("work_orders_maintenance_type_id_idx").on(table.maintenanceTypeId),
    index("work_orders_assigned_to_idx").on(table.assignedTo),
    check("work_orders_priority_check", sql`${table.priority} IN ('low', 'medium', 'high', 'critical')`),
    check(
      "work_orders_status_check",
      sql`${table.status} IN ('open', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled')`,
    ),
  ],
);
