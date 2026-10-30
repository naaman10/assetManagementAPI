import { index, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { locations } from "./locations.js";

/** One visual plan per floor location (MVP). */
export const locationPlans = pgTable(
  "location_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("location_plans_location_id_unique").on(table.locationId),
    uniqueIndex("location_plans_storage_key_unique").on(table.storageKey),
  ],
);

/** Clickable room/area shapes on a plan. Geometry uses normalized 0–1 plan coordinates. */
export const locationPlanFeatures = pgTable(
  "location_plan_features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => locationPlans.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    geometry: jsonb("geometry").notNull().$type<PlanFeatureGeometry>(),
    labelOverride: varchar("label_override", { length: 255 }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("location_plan_features_plan_id_idx").on(table.planId),
    index("location_plan_features_location_id_idx").on(table.locationId),
    uniqueIndex("location_plan_features_plan_location_unique").on(table.planId, table.locationId),
  ],
);

export type PlanFeatureGeometry = {
  type: "Polygon";
  coordinates: number[][][];
};
