import { index, pgTable, uuid } from "drizzle-orm/pg-core";
import { clientContacts } from "./clientContacts.js";
import { clients } from "./clients.js";
import { users } from "./users.js";

export const clientSettings = pgTable(
  "client_settings",
  {
    clientId: uuid("client_id")
      .primaryKey()
      .references(() => clients.id, { onDelete: "cascade" }),
    leadContactId: uuid("lead_contact_id").references(() => clientContacts.id, { onDelete: "set null" }),
    sponsorUserId: uuid("sponsor_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [index("client_settings_sponsor_user_id_idx").on(table.sponsorUserId)],
);
