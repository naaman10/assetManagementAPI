import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
