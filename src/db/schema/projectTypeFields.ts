import { boolean, index, integer, pgTable, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { projectTypes } from "./projectTypes.js";

export const projectTypeFieldDefinitions = pgTable(
  "project_type_field_definitions",
  {
    source: text("source").notNull(),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    description: text("description"),
  },
  (table) => [primaryKey({ columns: [table.source, table.fieldKey], name: "project_type_field_definitions_pk" })],
);

export const projectTypeFields = pgTable(
  "project_type_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectTypeId: uuid("project_type_id")
      .notNull()
      .references(() => projectTypes.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    fieldKey: text("field_key").notNull(),
    sortOrder: integer("sort_order").notNull(),
    required: boolean("required").notNull().default(false),
  },
  (table) => [
    unique("project_type_fields_type_source_key_unique").on(table.projectTypeId, table.source, table.fieldKey),
    index("project_type_fields_type_sort_idx").on(table.projectTypeId, table.sortOrder),
  ],
);
