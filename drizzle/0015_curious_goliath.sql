UPDATE "clients" SET "reference" = btrim("reference") WHERE "reference" IS NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM "clients" WHERE "reference" IS NULL OR "reference" = '') THEN
		RAISE EXCEPTION 'Every client needs a reference before maintenance schedule and work order numbers can be added.';
	END IF;

	IF EXISTS (SELECT 1 FROM "clients" GROUP BY "reference" HAVING COUNT(*) > 1) THEN
		RAISE EXCEPTION 'Client references must be unique before maintenance schedule and work order numbers can be added.';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "reference" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "clients_reference_unique" ON "clients" USING btree ("reference");
--> statement-breakpoint
CREATE TABLE "reference_counters" (
	"client_id" uuid NOT NULL,
	"kind" varchar(2) NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "reference_counters_client_id_kind_pk" PRIMARY KEY("client_id","kind"),
	CONSTRAINT "reference_counters_kind_check" CHECK ("reference_counters"."kind" IN ('MS', 'WO')),
	CONSTRAINT "reference_counters_value_check" CHECK ("reference_counters"."value" > 0)
);
--> statement-breakpoint
ALTER TABLE "reference_counters" ADD CONSTRAINT "reference_counters_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD COLUMN "reference" varchar(255);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "reference" varchar(255);
--> statement-breakpoint
WITH "numbered" AS (
	SELECT
		"maintenance_schedules"."id",
		"clients"."reference" || '-MS-' || row_number() OVER (PARTITION BY "clients"."id" ORDER BY "maintenance_schedules"."created_at", "maintenance_schedules"."id") AS "reference"
	FROM "maintenance_schedules"
	INNER JOIN "assets" ON "assets"."id" = "maintenance_schedules"."asset_id"
	INNER JOIN "locations" ON "locations"."id" = "assets"."location_id"
	INNER JOIN "sites" ON "sites"."id" = "locations"."site_id"
	INNER JOIN "clients" ON "clients"."id" = "sites"."client_id"
)
UPDATE "maintenance_schedules"
SET "reference" = "numbered"."reference"
FROM "numbered"
WHERE "maintenance_schedules"."id" = "numbered"."id";
--> statement-breakpoint
WITH "numbered" AS (
	SELECT
		"work_orders"."id",
		"clients"."reference" || '-WO-' || row_number() OVER (PARTITION BY "clients"."id" ORDER BY "work_orders"."created_at", "work_orders"."id") AS "reference"
	FROM "work_orders"
	INNER JOIN "assets" ON "assets"."id" = "work_orders"."asset_id"
	INNER JOIN "locations" ON "locations"."id" = "assets"."location_id"
	INNER JOIN "sites" ON "sites"."id" = "locations"."site_id"
	INNER JOIN "clients" ON "clients"."id" = "sites"."client_id"
)
UPDATE "work_orders"
SET "reference" = "numbered"."reference"
FROM "numbered"
WHERE "work_orders"."id" = "numbered"."id";
--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ALTER COLUMN "reference" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "reference" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_schedules_reference_unique" ON "maintenance_schedules" USING btree ("reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_reference_unique" ON "work_orders" USING btree ("reference");
--> statement-breakpoint
INSERT INTO "reference_counters" ("client_id", "kind", "value")
SELECT "clients"."id", 'MS', COUNT("maintenance_schedules"."id")::integer
FROM "clients"
INNER JOIN "sites" ON "sites"."client_id" = "clients"."id"
INNER JOIN "locations" ON "locations"."site_id" = "sites"."id"
INNER JOIN "assets" ON "assets"."location_id" = "locations"."id"
INNER JOIN "maintenance_schedules" ON "maintenance_schedules"."asset_id" = "assets"."id"
GROUP BY "clients"."id"
HAVING COUNT("maintenance_schedules"."id") > 0;
--> statement-breakpoint
INSERT INTO "reference_counters" ("client_id", "kind", "value")
SELECT "clients"."id", 'WO', COUNT("work_orders"."id")::integer
FROM "clients"
INNER JOIN "sites" ON "sites"."client_id" = "clients"."id"
INNER JOIN "locations" ON "locations"."site_id" = "sites"."id"
INNER JOIN "assets" ON "assets"."location_id" = "locations"."id"
INNER JOIN "work_orders" ON "work_orders"."asset_id" = "assets"."id"
GROUP BY "clients"."id"
HAVING COUNT("work_orders"."id") > 0;
