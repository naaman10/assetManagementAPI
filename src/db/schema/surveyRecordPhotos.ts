import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { surveyRecords } from "./surveyRecords.js";

export const surveyRecordPhotos = pgTable(
  "survey_record_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    surveyRecordId: uuid("survey_record_id")
      .notNull()
      .references(() => surveyRecords.id, { onDelete: "cascade" }),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("survey_record_photos_storage_key_unique").on(table.storageKey),
    index("survey_record_photos_survey_record_id_idx").on(table.surveyRecordId),
  ],
);
