import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clientContacts } from "./clientContacts.js";
import { clients } from "./clients.js";

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => clientContacts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    reference: text("reference"),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    county: text("county"),
    postcode: text("postcode").notNull(),
    country: text("country").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sites_client_id_idx").on(table.clientId)],
);
