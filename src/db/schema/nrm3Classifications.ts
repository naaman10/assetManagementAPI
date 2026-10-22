import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

export const nrm3Classifications = pgTable(
  "nrm3_classifications",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    level: smallint("level").notNull(),
    parentCode: text("parent_code"),
    maintainableAssetDescription: text("maintainable_asset_description"),
    renewalUom: text("renewal_uom"),
    maintenanceUom: text("maintenance_uom"),
    productMaterialType: text("product_material_type"),
    workPackage: text("work_package"),
    sourceVersion: text("source_version").notNull().default("2026-01"),
    sourceRow: integer("source_row"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_nrm3_level").on(table.level),
    index("idx_nrm3_parent_code").on(table.parentCode),
    foreignKey({
      columns: [table.parentCode],
      foreignColumns: [table.code],
      name: "nrm3_classifications_parent_code_fkey",
    }),
    check("nrm3_classifications_check", sql`(${table.parentCode} IS NULL) OR (${table.parentCode} <> ${table.code})`),
    check("nrm3_classifications_level_check", sql`(${table.level} >= 1) AND (${table.level} <= 5)`),
  ],
);
