CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"schedule_id" uuid,
	"maintenance_type_id" uuid NOT NULL,
	"assigned_to" uuid,
	"title" varchar(255) NOT NULL,
	"description" text,
	"priority" varchar(30) DEFAULT 'medium' NOT NULL,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"due_date" date,
	"scheduled_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_priority_check" CHECK ("work_orders"."priority" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "work_orders_status_check" CHECK ("work_orders"."status" IN ('open', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_schedule_id_maintenance_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."maintenance_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_maintenance_type_id_maintenance_types_id_fk" FOREIGN KEY ("maintenance_type_id") REFERENCES "public"."maintenance_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_orders_asset_id_idx" ON "work_orders" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "work_orders_schedule_id_idx" ON "work_orders" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "work_orders_maintenance_type_id_idx" ON "work_orders" USING btree ("maintenance_type_id");--> statement-breakpoint
CREATE INDEX "work_orders_assigned_to_idx" ON "work_orders" USING btree ("assigned_to");