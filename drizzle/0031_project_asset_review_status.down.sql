ALTER TABLE "project_assets" DROP CONSTRAINT IF EXISTS "project_assets_review_status_check";
DROP INDEX IF EXISTS "project_assets_project_review_status_idx";
ALTER TABLE "project_assets" DROP COLUMN IF EXISTS "review_status";
ALTER TABLE "project_assets" DROP COLUMN IF EXISTS "updated_at";
