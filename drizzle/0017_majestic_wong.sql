CREATE TABLE "maintenance_history_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"maintenance_history_id" uuid NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maintenance_history_photos" ADD CONSTRAINT "maintenance_history_photos_maintenance_history_id_maintenance_history_id_fk" FOREIGN KEY ("maintenance_history_id") REFERENCES "public"."maintenance_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_history_photos_storage_key_unique" ON "maintenance_history_photos" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "maintenance_history_photos_history_id_idx" ON "maintenance_history_photos" USING btree ("maintenance_history_id");