import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

const code = (name: string) => varchar(name, { length: 50 });
const label = (name: string) => varchar(name, { length: 255 });

function timestamps() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  };
}

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: code("code").notNull(),
    name: label("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (table) => [uniqueIndex("groups_code_unique").on(table.code)],
);

export const elements = pgTable(
  "elements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    code: code("code").notNull(),
    name: label("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (table) => [uniqueIndex("elements_code_unique").on(table.code), index("elements_group_id_idx").on(table.groupId)],
);

export const subElements = pgTable(
  "sub_elements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    elementId: uuid("element_id")
      .notNull()
      .references(() => elements.id, { onDelete: "restrict" }),
    code: code("code").notNull(),
    name: label("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (table) => [uniqueIndex("sub_elements_code_unique").on(table.code), index("sub_elements_element_id_idx").on(table.elementId)],
);

export const bcisRefs = pgTable(
  "bcis_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: code("code").notNull(),
    name: label("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (table) => [uniqueIndex("bcis_refs_code_unique").on(table.code)],
);

export const bcisSubRefs = pgTable(
  "bcis_sub_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bcisRefId: uuid("bcis_ref_id")
      .notNull()
      .references(() => bcisRefs.id, { onDelete: "restrict" }),
    code: code("code").notNull(),
    name: label("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (table) => [uniqueIndex("bcis_sub_refs_code_unique").on(table.code), index("bcis_sub_refs_bcis_ref_id_idx").on(table.bcisRefId)],
);
