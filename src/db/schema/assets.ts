import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { assetTypes } from "./assetTypes.js";
import { locations } from "./locations.js";
import { nrm3Classifications } from "./nrm3Classifications.js";

export const ASSET_STATUSES = [
  "active",
  "inactive",
  "out_of_service",
  "decommissioned",
  "disposed",
  "proposed",
  "under_installation",
  "awaiting_commissioning",
  "deleted",
] as const;

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    assetTypeId: uuid("asset_type_id")
      .notNull()
      .references(() => assetTypes.id, { onDelete: "restrict" }),
    nrm3Code: text("nrm3_code").references(() => nrm3Classifications.code, { onDelete: "restrict" }),
    parentAssetId: uuid("parent_asset_id"),
    assetRef: varchar("asset_ref", { length: 100 }).notNull(),
    assetName: text("asset_name"),
    description: text("description"),
    manufacturer: text("manufacturer"),
    model: varchar("model", { length: 150 }),
    serialNumber: varchar("serial_number", { length: 150 }),
    yearOfManufacture: integer("year_of_manufacture"),
    tag: varchar("tag", { length: 150 }),
    quantity: numeric("quantity", { precision: 12, scale: 2, mode: "number" }),
    unitOfMeasure: varchar("unit_of_measure", { length: 30 }),
    installationDate: date("installation_date", { mode: "string" }),
    estimatedAgeYears: integer("estimated_age_years"),
    expectedLifeYears: integer("expected_life_years"),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("assets_location_id_idx").on(table.locationId),
    index("assets_asset_type_id_idx").on(table.assetTypeId),
    index("assets_nrm3_code_idx").on(table.nrm3Code),
    index("assets_parent_asset_id_idx").on(table.parentAssetId),
    foreignKey({
      columns: [table.parentAssetId],
      foreignColumns: [table.id],
      name: "assets_parent_asset_id_assets_id_fk",
    }).onDelete("set null"),
    check(
      "assets_status_check",
      sql`${table.status} IN ('active', 'inactive', 'out_of_service', 'decommissioned', 'disposed', 'proposed', 'under_installation', 'awaiting_commissioning', 'deleted')`,
    ),
    check(
      "assets_estimated_age_years_check",
      sql`${table.estimatedAgeYears} IS NULL OR ${table.estimatedAgeYears} >= 0`,
    ),
    check(
      "assets_expected_life_years_check",
      sql`${table.expectedLifeYears} IS NULL OR ${table.expectedLifeYears} >= 0`,
    ),
    check(
      "assets_year_of_manufacture_check",
      sql`${table.yearOfManufacture} IS NULL OR (${table.yearOfManufacture} >= 1000 AND ${table.yearOfManufacture} <= 9999)`,
    ),
    check("assets_parent_asset_id_check", sql`${table.parentAssetId} IS NULL OR ${table.parentAssetId} <> ${table.id}`),
  ],
);
