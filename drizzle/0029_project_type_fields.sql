CREATE TABLE IF NOT EXISTS "project_type_field_definitions" (
	"source" text NOT NULL,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	CONSTRAINT "project_type_field_definitions_pk" PRIMARY KEY("source","field_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_type_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_type_id" uuid NOT NULL,
	"source" text NOT NULL,
	"field_key" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_type_fields" ADD CONSTRAINT "project_type_fields_project_type_id_project_types_id_fk" FOREIGN KEY ("project_type_id") REFERENCES "public"."project_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_type_fields" ADD CONSTRAINT "project_type_fields_type_source_key_unique" UNIQUE("project_type_id","source","field_key");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_type_fields_type_sort_idx" ON "project_type_fields" USING btree ("project_type_id","sort_order");
--> statement-breakpoint
INSERT INTO "project_type_field_definitions" ("source", "field_key", "label", "description")
VALUES
	('asset', 'tag', 'Tag', NULL),
	('asset', 'assetName', 'Asset name', NULL),
	('asset', 'quantity', 'Quantity', NULL),
	('asset', 'unitOfMeasure', 'Unit of measure', NULL),
	('asset', 'status', 'Status', NULL),
	('asset', 'locationId', 'Location', NULL),
	('asset', 'assetTypeId', 'Asset type', NULL),
	('asset', 'nrm3Code', 'NRM3 classification', NULL),
	('asset', 'parentAssetId', 'Parent asset', NULL),
	('asset', 'manufacturer', 'Manufacturer', NULL),
	('asset', 'model', 'Model', NULL),
	('asset', 'serialNumber', 'Serial number', NULL),
	('asset', 'yearOfManufacture', 'Year of manufacture', NULL),
	('maintenance_history', 'referenceNumber', 'Reference number', NULL),
	('maintenance_history', 'maintenanceTypeId', 'Maintenance type', NULL),
	('maintenance_history', 'workDescription', 'Work description', NULL),
	('maintenance_history', 'workOrderId', 'Work order', NULL),
	('maintenance_history', 'performedAt', 'Performed at', NULL),
	('maintenance_history', 'completedAt', 'Completed at', NULL),
	('maintenance_history', 'performedBy', 'Performed by', NULL),
	('maintenance_history', 'findings', 'Findings', NULL),
	('maintenance_history', 'actionsTaken', 'Actions taken', NULL),
	('maintenance_history', 'notes', 'Notes', NULL),
	('maintenance_history', 'conditionBefore', 'Condition before', NULL),
	('maintenance_history', 'conditionAfter', 'Condition after', NULL),
	('maintenance_history', 'outcome', 'Outcome', NULL),
	('maintenance_history', 'labourCost', 'Labour cost', NULL),
	('maintenance_history', 'materialsCost', 'Materials cost', NULL),
	('maintenance_history', 'otherCost', 'Other cost', NULL),
	('maintenance_history', 'nextRecommendedDate', 'Next recommended date', NULL),
	('survey_record', 'status', 'Status', NULL),
	('survey_record', 'surveyedAt', 'Surveyed at', NULL),
	('survey_record', 'conditionCode', 'Condition', NULL),
	('survey_record', 'componentDescription', 'Component description', NULL),
	('survey_record', 'estimatedAssetAgeYears', 'Estimated asset age (years)', NULL),
	('survey_record', 'estimatedRemainingLifeYears', 'Estimated remaining life (years)', NULL),
	('survey_record', 'quantityObserved', 'Quantity observed', NULL),
	('survey_record', 'unitOfMeasure', 'Unit of measure', NULL),
	('survey_record', 'observations', 'Observations', NULL),
	('survey_record', 'defectDetails', 'Defect details', NULL),
	('survey_record', 'riskConsequence', 'Risk consequence', NULL),
	('survey_record', 'riskLikelihood', 'Risk likelihood', NULL),
	('survey_record', 'riskScore', 'Risk score', NULL),
	('survey_record', 'furtherInvestigationRequired', 'Further investigation required', NULL),
	('survey_record', 'resurveyRequired', 'Resurvey required', NULL),
	('survey_record', 'comments', 'Comments', NULL),
	('survey_record', 'surveyorUserIds', 'Surveyors', NULL)
ON CONFLICT ("source", "field_key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description";
