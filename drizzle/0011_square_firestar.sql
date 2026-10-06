CREATE TABLE "audit_assets" (
	"audit_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "audit_assets_audit_id_asset_id_pk" PRIMARY KEY("audit_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"lead_user_id" uuid,
	"title" varchar(200) NOT NULL,
	"project_reference" varchar(100) NOT NULL,
	"status" varchar(30) DEFAULT 'scheduled' NOT NULL,
	"description" text,
	"start_date" date,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audits_status_check" CHECK ("audits"."status" IN ('scheduled', 'in_progress', 'completed')),
	CONSTRAINT "audits_due_date_check" CHECK ("audits"."due_date" IS NULL OR "audits"."start_date" IS NULL OR "audits"."due_date" >= "audits"."start_date")
);
--> statement-breakpoint
ALTER TABLE "audit_assets" ADD CONSTRAINT "audit_assets_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_assets" ADD CONSTRAINT "audit_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_lead_user_id_users_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_assets_asset_id_idx" ON "audit_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "audits_client_id_idx" ON "audits" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "audits_lead_user_id_idx" ON "audits" USING btree ("lead_user_id");