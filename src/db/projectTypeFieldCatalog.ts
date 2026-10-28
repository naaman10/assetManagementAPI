export const PROJECT_TYPE_FIELD_SOURCES = ["asset", "maintenance_history", "survey_record"] as const;

export type ProjectTypeFieldSource = (typeof PROJECT_TYPE_FIELD_SOURCES)[number];

export type ProjectTypeFieldDefinitionSeed = {
  source: ProjectTypeFieldSource;
  fieldKey: string;
  label: string;
  description: string | null;
};

/** Selectable fields for project-type configuration. Keys are stable camelCase identifiers. */
export const PROJECT_TYPE_FIELD_DEFINITIONS: ProjectTypeFieldDefinitionSeed[] = [
  { source: "asset", fieldKey: "tag", label: "Tag", description: null },
  { source: "asset", fieldKey: "assetName", label: "Asset name", description: null },
  { source: "asset", fieldKey: "quantity", label: "Quantity", description: null },
  { source: "asset", fieldKey: "unitOfMeasure", label: "Unit of measure", description: null },
  { source: "asset", fieldKey: "status", label: "Status", description: null },
  { source: "asset", fieldKey: "locationId", label: "Location", description: null },
  { source: "asset", fieldKey: "assetTypeId", label: "Asset type", description: null },
  { source: "asset", fieldKey: "nrm3Code", label: "NRM3 classification", description: null },
  { source: "asset", fieldKey: "parentAssetId", label: "Parent asset", description: null },
  { source: "asset", fieldKey: "manufacturer", label: "Manufacturer", description: null },
  { source: "asset", fieldKey: "model", label: "Model", description: null },
  { source: "asset", fieldKey: "serialNumber", label: "Serial number", description: null },
  { source: "asset", fieldKey: "yearOfManufacture", label: "Year of manufacture", description: null },

  { source: "maintenance_history", fieldKey: "referenceNumber", label: "Reference number", description: null },
  { source: "maintenance_history", fieldKey: "maintenanceTypeId", label: "Maintenance type", description: null },
  { source: "maintenance_history", fieldKey: "workDescription", label: "Work description", description: null },
  { source: "maintenance_history", fieldKey: "workOrderId", label: "Work order", description: null },
  { source: "maintenance_history", fieldKey: "performedAt", label: "Performed at", description: null },
  { source: "maintenance_history", fieldKey: "completedAt", label: "Completed at", description: null },
  { source: "maintenance_history", fieldKey: "performedBy", label: "Performed by", description: null },
  { source: "maintenance_history", fieldKey: "findings", label: "Findings", description: null },
  { source: "maintenance_history", fieldKey: "actionsTaken", label: "Actions taken", description: null },
  { source: "maintenance_history", fieldKey: "notes", label: "Notes", description: null },
  { source: "maintenance_history", fieldKey: "conditionBefore", label: "Condition before", description: null },
  { source: "maintenance_history", fieldKey: "conditionAfter", label: "Condition after", description: null },
  { source: "maintenance_history", fieldKey: "outcome", label: "Outcome", description: null },
  { source: "maintenance_history", fieldKey: "labourCost", label: "Labour cost", description: null },
  { source: "maintenance_history", fieldKey: "materialsCost", label: "Materials cost", description: null },
  { source: "maintenance_history", fieldKey: "otherCost", label: "Other cost", description: null },
  { source: "maintenance_history", fieldKey: "nextRecommendedDate", label: "Next recommended date", description: null },

  { source: "survey_record", fieldKey: "status", label: "Status", description: null },
  { source: "survey_record", fieldKey: "surveyedAt", label: "Surveyed at", description: null },
  { source: "survey_record", fieldKey: "conditionCode", label: "Condition", description: null },
  { source: "survey_record", fieldKey: "componentDescription", label: "Component description", description: null },
  { source: "survey_record", fieldKey: "estimatedAssetAgeYears", label: "Estimated asset age (years)", description: null },
  {
    source: "survey_record",
    fieldKey: "estimatedRemainingLifeYears",
    label: "Estimated remaining life (years)",
    description: null,
  },
  { source: "survey_record", fieldKey: "quantityObserved", label: "Quantity observed", description: null },
  { source: "survey_record", fieldKey: "unitOfMeasure", label: "Unit of measure", description: null },
  { source: "survey_record", fieldKey: "observations", label: "Observations", description: null },
  { source: "survey_record", fieldKey: "defectDetails", label: "Defect details", description: null },
  { source: "survey_record", fieldKey: "riskConsequence", label: "Risk consequence", description: null },
  { source: "survey_record", fieldKey: "riskLikelihood", label: "Risk likelihood", description: null },
  { source: "survey_record", fieldKey: "riskScore", label: "Risk score", description: null },
  {
    source: "survey_record",
    fieldKey: "furtherInvestigationRequired",
    label: "Further investigation required",
    description: null,
  },
  { source: "survey_record", fieldKey: "resurveyRequired", label: "Resurvey required", description: null },
  { source: "survey_record", fieldKey: "comments", label: "Comments", description: null },
  { source: "survey_record", fieldKey: "surveyorUserIds", label: "Surveyors", description: null },
];

export function catalogKey(source: string, fieldKey: string) {
  return `${source}:${fieldKey}`;
}
