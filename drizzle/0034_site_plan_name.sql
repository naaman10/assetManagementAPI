ALTER TABLE "location_plans" ADD COLUMN IF NOT EXISTS "name" varchar(255);
--> statement-breakpoint
UPDATE "location_plans" AS p
SET "name" = COALESCE(NULLIF(TRIM(l."name"), ''), NULLIF(TRIM(l."location_code"), ''), 'Floor plan')
FROM "locations" AS l
WHERE l."id" = p."location_id"
	AND (p."name" IS NULL OR TRIM(p."name") = '');
--> statement-breakpoint
UPDATE "location_plans"
SET "name" = 'Floor plan'
WHERE "name" IS NULL OR TRIM("name") = '';
--> statement-breakpoint
ALTER TABLE "location_plans" ALTER COLUMN "name" SET NOT NULL;
