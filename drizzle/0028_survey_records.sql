CREATE TABLE IF NOT EXISTS "survey_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'not_started' NOT NULL,
	"surveyed_at" timestamp with time zone,
	"condition_code" varchar(10),
	"component_description" text,
	"estimated_asset_age_years" integer,
	"estimated_remaining_life_years" integer,
	"quantity_observed" numeric(12, 3),
	"unit_of_measure" varchar(30),
	"observations" text,
	"defect_details" text,
	"risk_consequence" integer,
	"risk_likelihood" integer,
	"risk_score" integer,
	"further_investigation_required" boolean DEFAULT false NOT NULL,
	"resurvey_required" boolean DEFAULT false NOT NULL,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_record_users" (
	"survey_record_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "survey_record_users_survey_record_id_user_id_pk" PRIMARY KEY("survey_record_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_records" ADD CONSTRAINT "survey_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_records" ADD CONSTRAINT "survey_records_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_records" ADD CONSTRAINT "survey_records_project_asset_unique" UNIQUE("project_id","asset_id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_records" ADD CONSTRAINT "survey_records_id_project_unique" UNIQUE("id","project_id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_records" ADD CONSTRAINT "survey_records_status_check" CHECK ("status" IN ('not_started', 'in_progress', 'completed', 'requires_review', 'approved'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_records" ADD CONSTRAINT "survey_records_condition_check" CHECK (("condition_code" IS NULL) OR ("condition_code" IN ('A', 'B', 'C', 'D')));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_records" ADD CONSTRAINT "survey_records_age_check" CHECK (("estimated_asset_age_years" IS NULL) OR ("estimated_asset_age_years" >= 0));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_records" ADD CONSTRAINT "survey_records_life_check" CHECK (("estimated_remaining_life_years" IS NULL) OR ("estimated_remaining_life_years" >= 0));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_records" ADD CONSTRAINT "survey_records_quantity_check" CHECK (("quantity_observed" IS NULL) OR ("quantity_observed" >= 0));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_records" ADD CONSTRAINT "survey_records_risk_check" CHECK ((("risk_consequence" IS NULL) OR ("risk_consequence" >= 0)) AND (("risk_likelihood" IS NULL) OR ("risk_likelihood" >= 0)) AND (("risk_score" IS NULL) OR ("risk_score" >= 0)));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_record_users" ADD CONSTRAINT "survey_record_users_record_project_fk" FOREIGN KEY ("survey_record_id", "project_id") REFERENCES "public"."survey_records"("id", "project_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_record_users" ADD CONSTRAINT "survey_record_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_survey_records_project" ON "survey_records" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_survey_records_asset" ON "survey_records" USING btree ("asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_survey_records_status" ON "survey_records" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "survey_record_users_user_id_idx" ON "survey_record_users" USING btree ("user_id");
