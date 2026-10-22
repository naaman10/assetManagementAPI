ALTER TABLE "assets" DROP COLUMN IF EXISTS "tag";
--> statement-breakpoint
ALTER TABLE "assets" RENAME COLUMN "asset_ref" TO "tag";
