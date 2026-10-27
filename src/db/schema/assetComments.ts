import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { assets } from "./assets.js";
import { users } from "./users.js";

export const assetComments = pgTable(
  "asset_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("asset_comments_asset_id_idx").on(table.assetId),
    index("asset_comments_author_user_id_idx").on(table.authorUserId),
  ],
);

export const assetCommentMentions = pgTable(
  "asset_comment_mentions",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => assetComments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.commentId, table.userId] }),
    index("asset_comment_mentions_user_id_idx").on(table.userId),
  ],
);
