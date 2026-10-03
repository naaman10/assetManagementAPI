ALTER TABLE "users" DROP CONSTRAINT "users_google_sub_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth0_sub" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "google_sub";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth0_sub_unique" UNIQUE("auth0_sub");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");