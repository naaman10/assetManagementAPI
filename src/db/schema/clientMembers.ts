import { index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { clients } from "./clients.js";
import { users } from "./users.js";

export const clientMembers = pgTable(
  "client_members",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.clientId, table.userId] }), index("client_members_user_id_idx").on(table.userId)],
);
