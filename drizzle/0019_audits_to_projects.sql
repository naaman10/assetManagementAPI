INSERT INTO "project_types" ("code", "name", "description", "sort_order", "is_active")
SELECT 'AUDIT', 'Audit', 'Default type for projects migrated from audits.', 0, true
WHERE NOT EXISTS (SELECT 1 FROM "project_types" WHERE "code" = 'AUDIT');
--> statement-breakpoint
ALTER TABLE "audits" RENAME TO "projects";
--> statement-breakpoint
ALTER TABLE "projects" RENAME CONSTRAINT "audits_client_id_clients_id_fk" TO "projects_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" RENAME CONSTRAINT "audits_lead_user_id_users_id_fk" TO "projects_lead_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" RENAME CONSTRAINT "audits_status_check" TO "projects_status_check";
--> statement-breakpoint
ALTER TABLE "projects" RENAME CONSTRAINT "audits_due_date_check" TO "projects_due_date_check";
--> statement-breakpoint
ALTER INDEX "audits_client_id_idx" RENAME TO "projects_client_id_idx";
--> statement-breakpoint
ALTER INDEX "audits_lead_user_id_idx" RENAME TO "projects_lead_user_id_idx";
--> statement-breakpoint
ALTER TABLE "audit_assets" RENAME TO "project_assets";
--> statement-breakpoint
ALTER TABLE "project_assets" RENAME COLUMN "audit_id" TO "project_id";
--> statement-breakpoint
ALTER TABLE "project_assets" RENAME CONSTRAINT "audit_assets_audit_id_asset_id_pk" TO "project_assets_project_id_asset_id_pk";
--> statement-breakpoint
ALTER TABLE "project_assets" RENAME CONSTRAINT "audit_assets_audit_id_audits_id_fk" TO "project_assets_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_assets" RENAME CONSTRAINT "audit_assets_asset_id_assets_id_fk" TO "project_assets_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER INDEX "audit_assets_asset_id_idx" RENAME TO "project_assets_asset_id_idx";
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "project_type_id" uuid;
--> statement-breakpoint
UPDATE "projects"
SET "project_type_id" = (SELECT "id" FROM "project_types" WHERE "code" = 'AUDIT' LIMIT 1);
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "project_type_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_project_type_id_project_types_id_fk" FOREIGN KEY ("project_type_id") REFERENCES "public"."project_types"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "projects_project_type_id_idx" ON "projects" USING btree ("project_type_id");
