import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sites } from "./sites.js";

export const LOCATION_TYPES = ["building", "floor", "room", "area"] as const;
export const LOCATION_STATUSES = ["active", "inactive", "demolished"] as const;

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    parentLocationId: uuid("parent_location_id"),
    locationCode: varchar("location_code", { length: 100 }),
    name: varchar("name", { length: 255 }),
    locationType: varchar("location_type", { length: 30 }),
    description: text("description"),
    department: varchar("department", { length: 150 }),
    uprn: varchar("uprn", { length: 12 }),
    address: text("address"),
    latitude: numeric("latitude", { precision: 10, scale: 7, mode: "number" }),
    longitude: numeric("longitude", { precision: 10, scale: 7, mode: "number" }),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("locations_site_id_idx").on(table.siteId),
    index("locations_parent_location_id_idx").on(table.parentLocationId),
    index("locations_location_type_idx").on(table.locationType),
    index("locations_status_idx").on(table.status),
    unique("locations_id_site_id_unique").on(table.id, table.siteId),
    // Partial unique index (nulls-not-distinct + location_code IS NOT NULL) is in migration 0025.
    foreignKey({
      columns: [table.parentLocationId, table.siteId],
      foreignColumns: [table.id, table.siteId],
      name: "locations_parent_same_site_fk",
    }).onDelete("restrict"),
    check(
      "locations_parent_not_self_check",
      sql`${table.parentLocationId} IS NULL OR ${table.parentLocationId} <> ${table.id}`,
    ),
    check(
      "locations_location_type_check",
      sql`${table.locationType} IS NULL OR ${table.locationType} IN ('building', 'floor', 'room', 'area')`,
    ),
    check(
      "locations_status_check",
      sql`${table.status} IN ('active', 'inactive', 'demolished')`,
    ),
    check(
      "locations_latitude_check",
      sql`${table.latitude} IS NULL OR (${table.latitude} >= -90 AND ${table.latitude} <= 90)`,
    ),
    check(
      "locations_longitude_check",
      sql`${table.longitude} IS NULL OR (${table.longitude} >= -180 AND ${table.longitude} <= 180)`,
    ),
  ],
);
