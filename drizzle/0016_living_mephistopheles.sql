CREATE TABLE "maintenance_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"work_order_id" uuid,
	"maintenance_type_id" uuid NOT NULL,
	"performed_by" uuid,
	"reference_number" varchar(255) NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"work_description" text NOT NULL,
	"findings" text,
	"actions_taken" text,
	"condition_before" varchar(30),
	"condition_after" varchar(30),
	"outcome" varchar(30),
	"labour_cost" numeric(12, 2),
	"materials_cost" numeric(12, 2),
	"other_cost" numeric(12, 2),
	"next_recommended_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reference_counters" DROP CONSTRAINT "reference_counters_kind_check";--> statement-breakpoint
ALTER TABLE "maintenance_history" ADD CONSTRAINT "maintenance_history_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_history" ADD CONSTRAINT "maintenance_history_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_history" ADD CONSTRAINT "maintenance_history_maintenance_type_id_maintenance_types_id_fk" FOREIGN KEY ("maintenance_type_id") REFERENCES "public"."maintenance_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_history" ADD CONSTRAINT "maintenance_history_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_history_reference_number_unique" ON "maintenance_history" USING btree ("reference_number");--> statement-breakpoint
CREATE INDEX "maintenance_history_asset_id_idx" ON "maintenance_history" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "maintenance_history_work_order_id_idx" ON "maintenance_history" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "maintenance_history_maintenance_type_id_idx" ON "maintenance_history" USING btree ("maintenance_type_id");--> statement-breakpoint
CREATE INDEX "maintenance_history_performed_by_idx" ON "maintenance_history" USING btree ("performed_by");--> statement-breakpoint
ALTER TABLE "reference_counters" ADD CONSTRAINT "reference_counters_kind_check" CHECK ("reference_counters"."kind" IN ('MS', 'WO', 'MH'));