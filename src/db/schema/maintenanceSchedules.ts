import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { assets } from "./assets.js";
import { maintenanceTypes } from "./maintenanceTypes.js";

export const FREQUENCY_UNITS = ["days", "weeks", "months", "years"] as const;

export const maintenanceSchedules = pgTable(
  "maintenance_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    maintenanceTypeId: uuid("maintenance_type_id")
      .notNull()
      .references(() => maintenanceTypes.id, { onDelete: "restrict" }),
    reference: varchar("reference", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    frequencyValue: integer("frequency_value").notNull(),
    frequencyUnit: varchar("frequency_unit", { length: 20 }).notNull(),
    autoWorkorder: boolean("auto_workorder").notNull().default(false),
    startDate: date("start_date", { mode: "string" }),
    lastCompletedDate: date("last_completed_date", { mode: "string" }),
    nextDueDate: date("next_due_date", { mode: "string" }),
    estimatedDurationMinutes: integer("estimated_duration_minutes"),
    estimatedCost: numeric("estimated_cost", { precision: 12, scale: 2, mode: "number" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("maintenance_schedules_reference_unique").on(table.reference),
    index("maintenance_schedules_asset_id_idx").on(table.assetId),
    index("maintenance_schedules_maintenance_type_id_idx").on(table.maintenanceTypeId),
    check("maintenance_schedules_frequency_value_check", sql`${table.frequencyValue} > 0`),
    check(
      "maintenance_schedules_frequency_unit_check",
      sql`${table.frequencyUnit} IN ('days', 'weeks', 'months', 'years')`,
    ),
    check(
      "maintenance_schedules_estimated_duration_minutes_check",
      sql`${table.estimatedDurationMinutes} IS NULL OR ${table.estimatedDurationMinutes} >= 0`,
    ),
  ],
);
