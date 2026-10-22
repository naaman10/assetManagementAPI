ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "parent_location_id" uuid;
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "location_type" varchar(30);
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "department" varchar(150);
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "uprn" varchar(12);
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "address" text;
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "latitude" numeric(10, 7);
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "longitude" numeric(10, 7);
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "status" varchar(30) DEFAULT 'active' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_id_site_id_unique" UNIQUE ("id", "site_id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_same_site_fk" FOREIGN KEY ("parent_location_id", "site_id") REFERENCES "public"."locations"("id", "site_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_not_self_check" CHECK (("parent_location_id" IS NULL) OR ("parent_location_id" <> "id"));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_location_type_check" CHECK (("location_type" IS NULL) OR ("location_type" IN ('building', 'floor', 'room', 'area')));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_status_check" CHECK ("status" IN ('active', 'inactive', 'demolished'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_latitude_check" CHECK (("latitude" IS NULL) OR (("latitude" >= -90) AND ("latitude" <= 90)));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_longitude_check" CHECK (("longitude" IS NULL) OR (("longitude" >= -180) AND ("longitude" <= 180)));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "locations_parent_location_id_idx" ON "locations" USING btree ("parent_location_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "locations_location_type_idx" ON "locations" USING btree ("location_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "locations_status_idx" ON "locations" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "locations_site_parent_code_uidx" ON "locations" ("site_id", "parent_location_id", "location_code") NULLS NOT DISTINCT WHERE "location_code" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_location_id_locations_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_location_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_type varchar(30);
  walker uuid;
  visited uuid[] := ARRAY[]::uuid[];
  invalid_child boolean;
BEGIN
  parent_type := NULL;

  IF NEW.parent_location_id IS NOT NULL THEN
    PERFORM 1 FROM locations WHERE id = NEW.parent_location_id FOR UPDATE;

    SELECT location_type INTO parent_type
    FROM locations
    WHERE id = NEW.parent_location_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent location not found.'
        USING ERRCODE = '23503';
    END IF;

    IF parent_type = 'room' THEN
      RAISE EXCEPTION 'A room cannot contain child locations.'
        USING ERRCODE = '23514';
    END IF;

    walker := NEW.parent_location_id;
    WHILE walker IS NOT NULL LOOP
      IF walker = NEW.id THEN
        RAISE EXCEPTION 'Parent location would create a cycle.'
          USING ERRCODE = '23514';
      END IF;

      IF walker = ANY (visited) THEN
        EXIT;
      END IF;

      visited := array_append(visited, walker);

      SELECT parent_location_id INTO walker
      FROM locations
      WHERE id = walker
      FOR UPDATE;
    END LOOP;
  END IF;

  IF NEW.location_type IS NULL THEN
    IF NEW.parent_location_id IS NOT NULL THEN
      RAISE EXCEPTION 'A location without a type cannot have a parent.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.location_type = 'building' THEN
    IF NEW.parent_location_id IS NOT NULL THEN
      RAISE EXCEPTION 'A building must be a root location under the site.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.location_type = 'floor' THEN
    IF parent_type IS DISTINCT FROM 'building' THEN
      RAISE EXCEPTION 'A floor parent must be a building.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.location_type = 'room' THEN
    IF parent_type IS DISTINCT FROM 'floor' AND parent_type IS DISTINCT FROM 'building' THEN
      RAISE EXCEPTION 'A room parent must be a floor or building.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.location_type = 'area' THEN
    IF NEW.parent_location_id IS NOT NULL
       AND parent_type IS DISTINCT FROM 'building'
       AND parent_type IS DISTINCT FROM 'floor'
       AND parent_type IS DISTINCT FROM 'area' THEN
      RAISE EXCEPTION 'An area parent must be a building, floor, area, or the site root.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.location_type = 'room'
     AND OLD.location_type IS DISTINCT FROM 'room'
     AND EXISTS (SELECT 1 FROM locations WHERE parent_location_id = NEW.id) THEN
    RAISE EXCEPTION 'A room cannot contain child locations.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.location_type IS DISTINCT FROM OLD.location_type THEN
    SELECT EXISTS (
      SELECT 1
      FROM locations c
      WHERE c.parent_location_id = NEW.id
        AND NOT (
          (c.location_type = 'floor' AND NEW.location_type = 'building')
          OR (c.location_type = 'room' AND NEW.location_type IN ('floor', 'building'))
          OR (c.location_type = 'area' AND NEW.location_type IN ('building', 'floor', 'area'))
        )
    ) INTO invalid_child;

    IF invalid_child THEN
      RAISE EXCEPTION 'Location type change would invalidate child locations.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS locations_enforce_hierarchy ON "locations";
--> statement-breakpoint
CREATE TRIGGER locations_enforce_hierarchy
BEFORE INSERT OR UPDATE OF parent_location_id, location_type, site_id
ON "locations"
FOR EACH ROW
EXECUTE PROCEDURE enforce_location_hierarchy();
--> statement-breakpoint
DO $$
DECLARE
  untyped_count integer;
BEGIN
  SELECT count(*)::integer INTO untyped_count
  FROM locations
  WHERE location_type IS NULL;

  RAISE NOTICE 'location hierarchy migration: % existing location(s) have null location_type and require review', untyped_count;
END $$;
