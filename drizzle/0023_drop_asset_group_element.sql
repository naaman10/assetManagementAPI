ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_sub_element_id_sub_elements_id_fk";
--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_element_id_elements_id_fk";
--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_group_id_groups_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "assets_sub_element_id_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "assets_element_id_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "assets_group_id_idx";
--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN IF EXISTS "sub_element_id";
--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN IF EXISTS "element_id";
--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN IF EXISTS "group_id";
