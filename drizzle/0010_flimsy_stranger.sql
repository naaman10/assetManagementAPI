CREATE TABLE "bcis_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bcis_sub_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bcis_ref_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"element_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "element_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "sub_element_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "bcis_ref_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "bcis_sub_ref_id" uuid;--> statement-breakpoint
ALTER TABLE "bcis_sub_refs" ADD CONSTRAINT "bcis_sub_refs_bcis_ref_id_bcis_refs_id_fk" FOREIGN KEY ("bcis_ref_id") REFERENCES "public"."bcis_refs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elements" ADD CONSTRAINT "elements_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_elements" ADD CONSTRAINT "sub_elements_element_id_elements_id_fk" FOREIGN KEY ("element_id") REFERENCES "public"."elements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bcis_refs_code_unique" ON "bcis_refs" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "bcis_sub_refs_code_unique" ON "bcis_sub_refs" USING btree ("code");--> statement-breakpoint
CREATE INDEX "bcis_sub_refs_bcis_ref_id_idx" ON "bcis_sub_refs" USING btree ("bcis_ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "elements_code_unique" ON "elements" USING btree ("code");--> statement-breakpoint
CREATE INDEX "elements_group_id_idx" ON "elements" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_code_unique" ON "groups" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_elements_code_unique" ON "sub_elements" USING btree ("code");--> statement-breakpoint
CREATE INDEX "sub_elements_element_id_idx" ON "sub_elements" USING btree ("element_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_element_id_elements_id_fk" FOREIGN KEY ("element_id") REFERENCES "public"."elements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_sub_element_id_sub_elements_id_fk" FOREIGN KEY ("sub_element_id") REFERENCES "public"."sub_elements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_bcis_ref_id_bcis_refs_id_fk" FOREIGN KEY ("bcis_ref_id") REFERENCES "public"."bcis_refs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_bcis_sub_ref_id_bcis_sub_refs_id_fk" FOREIGN KEY ("bcis_sub_ref_id") REFERENCES "public"."bcis_sub_refs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_group_id_idx" ON "assets" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "assets_element_id_idx" ON "assets" USING btree ("element_id");--> statement-breakpoint
CREATE INDEX "assets_sub_element_id_idx" ON "assets" USING btree ("sub_element_id");--> statement-breakpoint
CREATE INDEX "assets_bcis_ref_id_idx" ON "assets" USING btree ("bcis_ref_id");--> statement-breakpoint
CREATE INDEX "assets_bcis_sub_ref_id_idx" ON "assets" USING btree ("bcis_sub_ref_id");
--> statement-breakpoint
INSERT INTO "groups" ("code", "name")
VALUES ('EBF', 'External Building Fabric')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "elements" ("group_id", "code", "name")
SELECT "id", 'ROOF-STR', 'Roof Structure' FROM "groups" WHERE "code" = 'EBF'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "sub_elements" ("element_id", "code", "name")
SELECT "id", 'TPR', 'Timber Purlin and Rafters' FROM "elements" WHERE "code" = 'ROOF-STR'
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "bcis_refs" ("code", "name")
VALUES ('2', 'Superstructure')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "bcis_sub_refs" ("bcis_ref_id", "code", "name")
SELECT "id", '2.3', 'Roof' FROM "bcis_refs" WHERE "code" = '2'
ON CONFLICT ("code") DO NOTHING;