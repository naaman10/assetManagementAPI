export const PROJECT_TYPE_FOCUSES = ["assets", "sites_locations"] as const;

export type ProjectTypeFocus = (typeof PROJECT_TYPE_FOCUSES)[number];

export const PROJECT_TYPE_FIELD_SOURCES = [
  "asset",
  "maintenance_history",
  "survey_record",
  "site",
  "location",
] as const;

export type ProjectTypeFieldSource = (typeof PROJECT_TYPE_FIELD_SOURCES)[number];

/** Value kinds for form rendering. Stable identifiers — labels may change; these should not. */
export const PROJECT_TYPE_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "select",
  "reference",
  "referenceList",
  "media",
] as const;

export type ProjectTypeFieldType = (typeof PROJECT_TYPE_FIELD_TYPES)[number];

export type ProjectTypeFieldDefinitionSeed = {
  source: ProjectTypeFieldSource;
  fieldKey: string;
  label: string;
  type: ProjectTypeFieldType;
  description: string | null;
  focus: ProjectTypeFocus;
};

/** Selectable fields for project-type configuration. Keys are stable camelCase identifiers. */
export const PROJECT_TYPE_FIELD_DEFINITIONS: ProjectTypeFieldDefinitionSeed[] = [
  { source: "asset", fieldKey: "tag", label: "Tag", type: "text", description: null, focus: "assets" },
  { source: "asset", fieldKey: "assetName", label: "Asset name", type: "text", description: null, focus: "assets" },
  { source: "asset", fieldKey: "quantity", label: "Quantity", type: "number", description: null, focus: "assets" },
  {
    source: "asset",
    fieldKey: "unitOfMeasure",
    label: "Unit of measure",
    type: "text",
    description: null,
    focus: "assets",
  },
  { source: "asset", fieldKey: "status", label: "Status", type: "select", description: null, focus: "assets" },
  { source: "asset", fieldKey: "locationId", label: "Location", type: "reference", description: null, focus: "assets" },
  {
    source: "asset",
    fieldKey: "assetTypeId",
    label: "Asset type",
    type: "reference",
    description: null,
    focus: "assets",
  },
  {
    source: "asset",
    fieldKey: "nrm3Code",
    label: "NRM3 classification",
    type: "reference",
    description: null,
    focus: "assets",
  },
  {
    source: "asset",
    fieldKey: "parentAssetId",
    label: "Parent asset",
    type: "reference",
    description: null,
    focus: "assets",
  },
  {
    source: "asset",
    fieldKey: "manufacturer",
    label: "Manufacturer",
    type: "text",
    description: null,
    focus: "assets",
  },
  { source: "asset", fieldKey: "model", label: "Model", type: "text", description: null, focus: "assets" },
  {
    source: "asset",
    fieldKey: "serialNumber",
    label: "Serial number",
    type: "text",
    description: null,
    focus: "assets",
  },
  {
    source: "asset",
    fieldKey: "yearOfManufacture",
    label: "Year of manufacture",
    type: "number",
    description: null,
    focus: "assets",
  },

  {
    source: "maintenance_history",
    fieldKey: "referenceNumber",
    label: "Reference number",
    type: "text",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "maintenanceTypeId",
    label: "Maintenance type",
    type: "reference",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "workDescription",
    label: "Work description",
    type: "text",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "workOrderId",
    label: "Work order",
    type: "reference",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "performedAt",
    label: "Performed at",
    type: "datetime",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "completedAt",
    label: "Completed at",
    type: "datetime",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "performedBy",
    label: "Performed by",
    type: "reference",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "findings",
    label: "Findings",
    type: "text",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "actionsTaken",
    label: "Actions taken",
    type: "text",
    description: null,
    focus: "assets",
  },
  { source: "maintenance_history", fieldKey: "notes", label: "Notes", type: "text", description: null, focus: "assets" },
  {
    source: "maintenance_history",
    fieldKey: "conditionBefore",
    label: "Condition before",
    type: "select",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "conditionAfter",
    label: "Condition after",
    type: "select",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "outcome",
    label: "Outcome",
    type: "select",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "labourCost",
    label: "Labour cost",
    type: "number",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "materialsCost",
    label: "Materials cost",
    type: "number",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "otherCost",
    label: "Other cost",
    type: "number",
    description: null,
    focus: "assets",
  },
  {
    source: "maintenance_history",
    fieldKey: "nextRecommendedDate",
    label: "Next recommended date",
    type: "date",
    description: null,
    focus: "assets",
  },

  { source: "survey_record", fieldKey: "status", label: "Status", type: "select", description: null, focus: "assets" },
  {
    source: "survey_record",
    fieldKey: "surveyedAt",
    label: "Surveyed at",
    type: "datetime",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "conditionCode",
    label: "Condition",
    type: "select",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "componentDescription",
    label: "Component description",
    type: "text",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "estimatedAssetAgeYears",
    label: "Estimated asset age (years)",
    type: "number",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "estimatedRemainingLifeYears",
    label: "Estimated remaining life (years)",
    type: "number",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "quantityObserved",
    label: "Quantity observed",
    type: "number",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "unitOfMeasure",
    label: "Unit of measure",
    type: "text",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "observations",
    label: "Observations",
    type: "text",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "defectDetails",
    label: "Defect details",
    type: "text",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "riskConsequence",
    label: "Risk consequence",
    type: "number",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "riskLikelihood",
    label: "Risk likelihood",
    type: "number",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "riskScore",
    label: "Risk score",
    type: "number",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "furtherInvestigationRequired",
    label: "Further investigation required",
    type: "boolean",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "resurveyRequired",
    label: "Resurvey required",
    type: "boolean",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "comments",
    label: "Comments",
    type: "text",
    description: null,
    focus: "assets",
  },
  {
    source: "survey_record",
    fieldKey: "surveyorUserIds",
    label: "Surveyors",
    type: "referenceList",
    description: null,
    focus: "assets",
  },
  { source: "survey_record", fieldKey: "photos", label: "Photos", type: "media", description: null, focus: "assets" },

  {
    source: "site",
    fieldKey: "name",
    label: "Site name",
    type: "text",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "site",
    fieldKey: "reference",
    label: "Site reference",
    type: "text",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "site",
    fieldKey: "addressLine1",
    label: "Address line 1",
    type: "text",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "site",
    fieldKey: "addressLine2",
    label: "Address line 2",
    type: "text",
    description: null,
    focus: "sites_locations",
  },
  { source: "site", fieldKey: "city", label: "City", type: "text", description: null, focus: "sites_locations" },
  { source: "site", fieldKey: "county", label: "County", type: "text", description: null, focus: "sites_locations" },
  {
    source: "site",
    fieldKey: "postcode",
    label: "Postcode",
    type: "text",
    description: null,
    focus: "sites_locations",
  },
  { source: "site", fieldKey: "country", label: "Country", type: "text", description: null, focus: "sites_locations" },
  {
    source: "site",
    fieldKey: "contactId",
    label: "Site contact",
    type: "reference",
    description: null,
    focus: "sites_locations",
  },

  {
    source: "location",
    fieldKey: "locationCode",
    label: "Location code",
    type: "text",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "location",
    fieldKey: "name",
    label: "Location name",
    type: "text",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "location",
    fieldKey: "locationType",
    label: "Location type",
    type: "select",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "location",
    fieldKey: "description",
    label: "Description",
    type: "text",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "location",
    fieldKey: "department",
    label: "Department",
    type: "text",
    description: null,
    focus: "sites_locations",
  },
  { source: "location", fieldKey: "uprn", label: "UPRN", type: "text", description: null, focus: "sites_locations" },
  {
    source: "location",
    fieldKey: "address",
    label: "Address",
    type: "text",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "location",
    fieldKey: "latitude",
    label: "Latitude",
    type: "number",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "location",
    fieldKey: "longitude",
    label: "Longitude",
    type: "number",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "location",
    fieldKey: "status",
    label: "Status",
    type: "select",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "location",
    fieldKey: "parentLocationId",
    label: "Parent location",
    type: "reference",
    description: null,
    focus: "sites_locations",
  },
  {
    source: "location",
    fieldKey: "siteId",
    label: "Site",
    type: "reference",
    description: null,
    focus: "sites_locations",
  },
];

export function catalogKey(source: string, fieldKey: string) {
  return `${source}:${fieldKey}`;
}

export function focusForSource(source: ProjectTypeFieldSource): ProjectTypeFocus {
  return source === "site" || source === "location" ? "sites_locations" : "assets";
}

export function sourcesForFocus(focus: ProjectTypeFocus): ProjectTypeFieldSource[] {
  return PROJECT_TYPE_FIELD_SOURCES.filter((source) => focusForSource(source) === focus);
}

export function definitionsForFocus(focus: ProjectTypeFocus | null | undefined) {
  if (!focus) {
    return PROJECT_TYPE_FIELD_DEFINITIONS;
  }

  return PROJECT_TYPE_FIELD_DEFINITIONS.filter((definition) => definition.focus === focus);
}
