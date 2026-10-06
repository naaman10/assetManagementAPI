import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const assetTypes = pgTable(
  "asset_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id"),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    classificationType: varchar("classification_type", { length: 30 }).notNull().default("asset"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("asset_types_code_unique").on(table.code),
    index("idx_asset_types_parent").on(table.parentId),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "asset_types_parent_id_asset_types_id_fk",
    }),
    check(
      "asset_types_classification_type_check",
      sql`${table.classificationType} IN ('group', 'system', 'element', 'asset', 'component')`,
    ),
  ],
);
