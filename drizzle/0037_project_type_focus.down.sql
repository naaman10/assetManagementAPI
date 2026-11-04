DROP TABLE IF EXISTS "project_location_records";
DROP TABLE IF EXISTS "project_locations";
DROP TABLE IF EXISTS "project_sites";
ALTER TABLE "project_types" DROP CONSTRAINT IF EXISTS "project_types_focus_check";
ALTER TABLE "project_types" DROP COLUMN IF EXISTS "focus";
