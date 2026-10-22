ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_bcis_sub_ref_id_bcis_sub_refs_id_fk";
--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_bcis_ref_id_bcis_refs_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "assets_bcis_sub_ref_id_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "assets_bcis_ref_id_idx";
--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN IF EXISTS "bcis_sub_ref_id";
--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN IF EXISTS "bcis_ref_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "bcis_sub_refs";
--> statement-breakpoint
DROP TABLE IF EXISTS "bcis_refs";
--> statement-breakpoint
DELETE FROM "permissions"
WHERE "name" IN (
  'bcisRef:view',
  'bcisRef:create',
  'bcisRef:edit',
  'bcisRef:delete',
  'bcisSubRef:view',
  'bcisSubRef:create',
  'bcisSubRef:edit',
  'bcisSubRef:delete'
);
