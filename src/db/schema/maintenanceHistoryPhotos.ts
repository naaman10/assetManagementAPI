import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { maintenanceHistory } from "./maintenanceHistory.js";

export const maintenanceHistoryPhotos = pgTable(
  "maintenance_history_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    maintenanceHistoryId: uuid("maintenance_history_id")
      .notNull()
      .references(() => maintenanceHistory.id, { onDelete: "cascade" }),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    caption: text("caption"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("maintenance_history_photos_storage_key_unique").on(table.storageKey),
    index("maintenance_history_photos_history_id_idx").on(table.maintenanceHistoryId),
  ],
);
