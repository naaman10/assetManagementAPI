ALTER TABLE "project_type_field_definitions" ADD COLUMN IF NOT EXISTS "field_type" text;
--> statement-breakpoint
INSERT INTO "project_type_field_definitions" ("source", "field_key", "label", "field_type", "description")
VALUES
	('asset', 'tag', 'Tag', 'text', NULL),
	('asset', 'assetName', 'Asset name', 'text', NULL),
	('asset', 'quantity', 'Quantity', 'number', NULL),
	('asset', 'unitOfMeasure', 'Unit of measure', 'text', NULL),
	('asset', 'status', 'Status', 'select', NULL),
	('asset', 'locationId', 'Location', 'reference', NULL),
	('asset', 'assetTypeId', 'Asset type', 'reference', NULL),
	('asset', 'nrm3Code', 'NRM3 classification', 'reference', NULL),
	('asset', 'parentAssetId', 'Parent asset', 'reference', NULL),
	('asset', 'manufacturer', 'Manufacturer', 'text', NULL),
	('asset', 'model', 'Model', 'text', NULL),
	('asset', 'serialNumber', 'Serial number', 'text', NULL),
	('asset', 'yearOfManufacture', 'Year of manufacture', 'number', NULL),
	('maintenance_history', 'referenceNumber', 'Reference number', 'text', NULL),
	('maintenance_history', 'maintenanceTypeId', 'Maintenance type', 'reference', NULL),
	('maintenance_history', 'workDescription', 'Work description', 'text', NULL),
	('maintenance_history', 'workOrderId', 'Work order', 'reference', NULL),
	('maintenance_history', 'performedAt', 'Performed at', 'datetime', NULL),
	('maintenance_history', 'completedAt', 'Completed at', 'datetime', NULL),
	('maintenance_history', 'performedBy', 'Performed by', 'reference', NULL),
	('maintenance_history', 'findings', 'Findings', 'text', NULL),
	('maintenance_history', 'actionsTaken', 'Actions taken', 'text', NULL),
	('maintenance_history', 'notes', 'Notes', 'text', NULL),
	('maintenance_history', 'conditionBefore', 'Condition before', 'select', NULL),
	('maintenance_history', 'conditionAfter', 'Condition after', 'select', NULL),
	('maintenance_history', 'outcome', 'Outcome', 'select', NULL),
	('maintenance_history', 'labourCost', 'Labour cost', 'number', NULL),
	('maintenance_history', 'materialsCost', 'Materials cost', 'number', NULL),
	('maintenance_history', 'otherCost', 'Other cost', 'number', NULL),
	('maintenance_history', 'nextRecommendedDate', 'Next recommended date', 'date', NULL),
	('survey_record', 'status', 'Status', 'select', NULL),
	('survey_record', 'surveyedAt', 'Surveyed at', 'datetime', NULL),
	('survey_record', 'conditionCode', 'Condition', 'select', NULL),
	('survey_record', 'componentDescription', 'Component description', 'text', NULL),
	('survey_record', 'estimatedAssetAgeYears', 'Estimated asset age (years)', 'number', NULL),
	('survey_record', 'estimatedRemainingLifeYears', 'Estimated remaining life (years)', 'number', NULL),
	('survey_record', 'quantityObserved', 'Quantity observed', 'number', NULL),
	('survey_record', 'unitOfMeasure', 'Unit of measure', 'text', NULL),
	('survey_record', 'observations', 'Observations', 'text', NULL),
	('survey_record', 'defectDetails', 'Defect details', 'text', NULL),
	('survey_record', 'riskConsequence', 'Risk consequence', 'number', NULL),
	('survey_record', 'riskLikelihood', 'Risk likelihood', 'number', NULL),
	('survey_record', 'riskScore', 'Risk score', 'number', NULL),
	('survey_record', 'furtherInvestigationRequired', 'Further investigation required', 'boolean', NULL),
	('survey_record', 'resurveyRequired', 'Resurvey required', 'boolean', NULL),
	('survey_record', 'comments', 'Comments', 'text', NULL),
	('survey_record', 'surveyorUserIds', 'Surveyors', 'referenceList', NULL)
ON CONFLICT ("source", "field_key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "field_type" = EXCLUDED."field_type",
  "description" = EXCLUDED."description";
--> statement-breakpoint
UPDATE "project_type_field_definitions" SET "field_type" = 'text' WHERE "field_type" IS NULL;
--> statement-breakpoint
ALTER TABLE "project_type_field_definitions" ALTER COLUMN "field_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_type_fields" ADD COLUMN IF NOT EXISTS "required" boolean DEFAULT false NOT NULL;
