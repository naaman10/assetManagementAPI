ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_google_sub_unique";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_google_sub_key";
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth0_sub" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "permissions" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "google_sub";
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" ADD CONSTRAINT "users_auth0_sub_unique" UNIQUE("auth0_sub");
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
