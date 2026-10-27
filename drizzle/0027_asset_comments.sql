CREATE TABLE IF NOT EXISTS "asset_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_comment_mentions" (
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "asset_comment_mentions_comment_id_user_id_pk" PRIMARY KEY("comment_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_comments" ADD CONSTRAINT "asset_comments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_comments" ADD CONSTRAINT "asset_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_comment_mentions" ADD CONSTRAINT "asset_comment_mentions_comment_id_asset_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."asset_comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "asset_comment_mentions" ADD CONSTRAINT "asset_comment_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_comments_asset_id_idx" ON "asset_comments" USING btree ("asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_comments_author_user_id_idx" ON "asset_comments" USING btree ("author_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_comment_mentions_user_id_idx" ON "asset_comment_mentions" USING btree ("user_id");
