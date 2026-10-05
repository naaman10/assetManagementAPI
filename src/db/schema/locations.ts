import { index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { sites } from "./sites.js";

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    locationCode: varchar("location_code", { length: 100 }),
    name: varchar("name", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("locations_site_id_idx").on(table.siteId)],
);
