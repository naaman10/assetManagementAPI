CREATE TABLE "client_members" (
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "client_members_client_id_user_id_pk" PRIMARY KEY("client_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "client_settings" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"lead_contact_id" uuid,
	"sponsor_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "client_members" ADD CONSTRAINT "client_members_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_members" ADD CONSTRAINT "client_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_settings" ADD CONSTRAINT "client_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_settings" ADD CONSTRAINT "client_settings_lead_contact_id_client_contacts_id_fk" FOREIGN KEY ("lead_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_settings" ADD CONSTRAINT "client_settings_sponsor_user_id_users_id_fk" FOREIGN KEY ("sponsor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_members_user_id_idx" ON "client_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "client_settings_sponsor_user_id_idx" ON "client_settings" USING btree ("sponsor_user_id");--> statement-breakpoint
INSERT INTO "client_settings" ("client_id")
SELECT "id" FROM "clients"
ON CONFLICT ("client_id") DO NOTHING;