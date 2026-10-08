CREATE TABLE "maintenance_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"maintenance_type_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"frequency_value" integer NOT NULL,
	"frequency_unit" varchar(20) NOT NULL,
	"auto_workorder" boolean DEFAULT false NOT NULL,
	"start_date" date,
	"last_completed_date" date,
	"next_due_date" date,
	"estimated_duration_minutes" integer,
	"estimated_cost" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_schedules_frequency_value_check" CHECK ("maintenance_schedules"."frequency_value" > 0),
	CONSTRAINT "maintenance_schedules_frequency_unit_check" CHECK ("maintenance_schedules"."frequency_unit" IN ('days', 'weeks', 'months', 'years')),
	CONSTRAINT "maintenance_schedules_estimated_duration_minutes_check" CHECK ("maintenance_schedules"."estimated_duration_minutes" IS NULL OR "maintenance_schedules"."estimated_duration_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_maintenance_type_id_maintenance_types_id_fk" FOREIGN KEY ("maintenance_type_id") REFERENCES "public"."maintenance_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_schedules_asset_id_idx" ON "maintenance_schedules" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "maintenance_schedules_maintenance_type_id_idx" ON "maintenance_schedules" USING btree ("maintenance_type_id");