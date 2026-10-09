import { date, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { assets } from "./assets.js";
import { maintenanceTypes } from "./maintenanceTypes.js";
import { users } from "./users.js";
import { workOrders } from "./workOrders.js";

export const maintenanceHistory = pgTable(
  "maintenance_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    workOrderId: uuid("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
    maintenanceTypeId: uuid("maintenance_type_id")
      .notNull()
      .references(() => maintenanceTypes.id, { onDelete: "restrict" }),
    performedBy: uuid("performed_by").references(() => users.id, { onDelete: "set null" }),
    referenceNumber: varchar("reference_number", { length: 255 }).notNull(),
    performedAt: timestamp("performed_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    workDescription: text("work_description").notNull(),
    findings: text("findings"),
    actionsTaken: text("actions_taken"),
    conditionBefore: varchar("condition_before", { length: 30 }),
    conditionAfter: varchar("condition_after", { length: 30 }),
    outcome: varchar("outcome", { length: 30 }),
    labourCost: numeric("labour_cost", { precision: 12, scale: 2, mode: "number" }),
    materialsCost: numeric("materials_cost", { precision: 12, scale: 2, mode: "number" }),
    otherCost: numeric("other_cost", { precision: 12, scale: 2, mode: "number" }),
    nextRecommendedDate: date("next_recommended_date", { mode: "string" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("maintenance_history_reference_number_unique").on(table.referenceNumber),
    index("maintenance_history_asset_id_idx").on(table.assetId),
    index("maintenance_history_work_order_id_idx").on(table.workOrderId),
    index("maintenance_history_maintenance_type_id_idx").on(table.maintenanceTypeId),
    index("maintenance_history_performed_by_idx").on(table.performedBy),
  ],
);
