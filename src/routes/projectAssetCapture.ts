import { and, asc, eq, inArray, type ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { nextReference } from "../db/nextReference.js";
import {
  PROJECT_TYPE_FIELD_DEFINITIONS,
  catalogKey,
  type ProjectTypeFieldSource,
  type ProjectTypeFieldType,
} from "../db/projectTypeFieldCatalog.js";
import type * as schema from "../db/schema/index.js";
import {
  ASSET_STATUSES,
  SURVEY_CONDITION_CODES,
  SURVEY_RECORD_STATUSES,
  assetTypes,
  assets,
  locations,
  maintenanceHistory,
  maintenanceTypes,
  nrm3Classifications,
  projectAssets,
  projectTypeFields,
  projectTypes,
  projects,
  sites,
  surveyRecordUsers,
  surveyRecords,
  users,
  workOrders,
} from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv, AuthUser } from "../types.js";
import { readBody, routeError } from "./http.js";

type CaptureDb =
  | Database
  | PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

const catalogByKey = new Map(
  PROJECT_TYPE_FIELD_DEFINITIONS.map((definition) => [
    catalogKey(definition.source, definition.fieldKey),
    definition,
  ]),
);

/** Asset keys that can be written from capture save. locationId is display-only here. */
const ASSET_WRITABLE_KEYS = new Set([
  "tag",
  "assetName",
  "quantity",
  "unitOfMeasure",
  "status",
  "assetTypeId",
  "nrm3Code",
  "parentAssetId",
  "manufacturer",
  "model",
  "serialNumber",
  "yearOfManufacture",
]);

/** Assigned by the server on create — never taken from capture payload. */
const MH_SERVER_KEYS = new Set(["referenceNumber"]);

const MH_CREATE_REQUIRED_KEYS = ["maintenanceTypeId", "performedAt", "workDescription"] as const;

const saveCaptureSchema = z.object({
  asset: z.record(z.string(), z.unknown()).optional(),
  maintenanceHistory: z.record(z.string(), z.unknown()).nullable().optional(),
  surveyRecord: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const projectAssetCaptureRoutes = new Hono<AppEnv>();

projectAssetCaptureRoutes.get("/projects/:projectId/assets/:assetId/capture", requireUser, async (c) => {
  const projectId = parseId(c.req.param("projectId"));
  const assetId = parseId(c.req.param("assetId"));

  if (!projectId || !assetId) {
    return c.json({ error: "Not found." }, 404);
  }

  const capture = await loadCapture(c.get("services").db, c.get("user"), projectId, assetId);

  if (!capture) {
    return c.json({ error: "Not found." }, 404);
  }

  return c.json({ capture });
});

projectAssetCaptureRoutes.put("/projects/:projectId/assets/:assetId/capture", requireUser, async (c) => {
  const projectId = parseId(c.req.param("projectId"));
  const assetId = parseId(c.req.param("assetId"));

  if (!projectId || !assetId) {
    return c.json({ error: "Not found." }, 404);
  }

  const parsed = saveCaptureSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400);
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const context = await loadCaptureContext(db, user, projectId, assetId);

  if (!context) {
    return c.json({ error: "Not found." }, 404);
  }

  const assetValues = parsed.data.asset ?? {};
  const maintenanceHistoryValues =
    parsed.data.maintenanceHistory === undefined ? undefined : (parsed.data.maintenanceHistory ?? {});
  const surveyRecordValues = parsed.data.surveyRecord === undefined ? undefined : (parsed.data.surveyRecord ?? {});

  const fieldsBySource = groupConfiguredFields(context.fields);
  const fieldErrors: string[] = [];

  for (const field of context.fields) {
    if (!field.required) {
      continue;
    }

    if (field.source === "asset") {
      if (isEmptyValue(assetValues[field.key])) {
        fieldErrors.push(`${field.source}.${field.key} is required.`);
      }
      continue;
    }

    if (field.source === "maintenance_history") {
      if (MH_SERVER_KEYS.has(field.key)) {
        continue;
      }

      if (maintenanceHistoryValues === undefined || isEmptyValue(maintenanceHistoryValues[field.key])) {
        fieldErrors.push(`${field.source}.${field.key} is required.`);
      }
      continue;
    }

    if (surveyRecordValues === undefined || isEmptyValue(surveyRecordValues[field.key])) {
      fieldErrors.push(`${field.source}.${field.key} is required.`);
    }
  }

  const shouldCreateMaintenanceHistory =
    fieldsBySource.maintenance_history.length > 0 && maintenanceHistoryValues !== undefined;
  const shouldWriteSurvey = fieldsBySource.survey_record.length > 0 && surveyRecordValues !== undefined;

  if (shouldCreateMaintenanceHistory && maintenanceHistoryValues) {
    for (const key of MH_CREATE_REQUIRED_KEYS) {
      if (isEmptyValue(maintenanceHistoryValues[key])) {
        fieldErrors.push(`maintenance_history.${key} is required to create a maintenance history record.`);
      }
    }
  }

  if (fieldErrors.length > 0) {
    return c.json({ error: "Invalid request", details: { fields: fieldErrors } }, 400);
  }

  let createdSurveyRecordId: string | null = null;
  let createdMaintenanceHistoryId: string | null = null;
  let updatedSurveyRecordId: string | null = null;

  try {
    await db.transaction(async (tx) => {
      if (fieldsBySource.asset.length > 0) {
        const assetPatch = await buildAssetPatch(tx, user, context, assetValues, fieldsBySource.asset);

        if (!assetPatch.ok) {
          throw new CaptureHttpError(assetPatch.error, assetPatch.status);
        }

        if (Object.keys(assetPatch.patch).length > 0) {
          await tx
            .update(assets)
            .set({ ...assetPatch.patch, updatedAt: new Date() })
            .where(eq(assets.id, assetId));
        }
      }

      if (shouldCreateMaintenanceHistory && maintenanceHistoryValues) {
        const mh = await createMaintenanceHistoryFromCapture(
          tx,
          user,
          context,
          maintenanceHistoryValues,
          fieldsBySource.maintenance_history,
        );

        if (!mh.ok) {
          throw new CaptureHttpError(mh.error, mh.status);
        }

        createdMaintenanceHistoryId = mh.id;
      }

      if (shouldWriteSurvey && surveyRecordValues) {
        const survey = await upsertSurveyFromCapture(
          tx,
          context,
          surveyRecordValues,
          fieldsBySource.survey_record,
        );

        if (!survey.ok) {
          throw new CaptureHttpError(survey.error, survey.status);
        }

        if (survey.created) {
          createdSurveyRecordId = survey.id;
        } else {
          updatedSurveyRecordId = survey.id;
        }
      }
    });
  } catch (error) {
    if (error instanceof CaptureHttpError) {
      return c.json({ error: error.message }, error.status);
    }

    return routeError(c, error);
  }

  const capture = await loadCapture(db, user, projectId, assetId);

  if (!capture) {
    return c.json({ error: "Not found." }, 404);
  }

  return c.json({
    capture,
    surveyRecordId: createdSurveyRecordId ?? updatedSurveyRecordId,
    surveyRecordCreated: createdSurveyRecordId != null,
    maintenanceHistoryId: createdMaintenanceHistoryId,
  });
});

class CaptureHttpError extends Error {
  status: 400 | 404;

  constructor(message: string, status: 400 | 404) {
    super(message);
    this.status = status;
  }
}

type ConfiguredField = {
  source: ProjectTypeFieldSource;
  key: string;
  label: string;
  type: ProjectTypeFieldType | string;
  required: boolean;
  sortOrder: number;
};

type CaptureContext = {
  projectId: string;
  projectTitle: string;
  projectReference: string;
  projectTypeId: string;
  projectTypeCode: string;
  projectTypeName: string;
  clientId: string;
  asset: {
    id: string;
    locationId: string;
    assetTypeId: string;
    tag: string;
    assetName: string | null;
    quantity: number | null;
    unitOfMeasure: string | null;
    status: string;
    nrm3Code: string | null;
    parentAssetId: string | null;
    manufacturer: string | null;
    model: string | null;
    serialNumber: string | null;
    yearOfManufacture: number | null;
  };
  fields: ConfiguredField[];
};

async function loadCapture(db: Database, user: AuthUser, projectId: string, assetId: string) {
  const context = await loadCaptureContext(db, user, projectId, assetId);

  if (!context) {
    return null;
  }

  const assetValues = assetValueMap(context.asset);

  return {
    project: {
      id: context.projectId,
      title: context.projectTitle,
      projectReference: context.projectReference,
      projectTypeId: context.projectTypeId,
      projectType: {
        id: context.projectTypeId,
        code: context.projectTypeCode,
        name: context.projectTypeName,
      },
    },
    asset: {
      id: context.asset.id,
      tag: context.asset.tag,
      assetName: context.asset.assetName,
      locationId: context.asset.locationId,
      assetTypeId: context.asset.assetTypeId,
      status: context.asset.status,
    },
    fields: context.fields.map((field) => ({
      source: field.source,
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      sortOrder: field.sortOrder,
      value: field.source === "asset" ? (assetValues[field.key] ?? null) : null,
    })),
  };
}

async function loadCaptureContext(db: Database, user: AuthUser, projectId: string, assetId: string) {
  const [row] = await db
    .select({
      projectId: projects.id,
      projectTitle: projects.title,
      projectReference: projects.projectReference,
      projectTypeId: projects.projectTypeId,
      projectTypeCode: projectTypes.code,
      projectTypeName: projectTypes.name,
      clientId: projects.clientId,
      assetId: assets.id,
      locationId: assets.locationId,
      assetTypeId: assets.assetTypeId,
      tag: assets.tag,
      assetName: assets.assetName,
      quantity: assets.quantity,
      unitOfMeasure: assets.unitOfMeasure,
      status: assets.status,
      nrm3Code: assets.nrm3Code,
      parentAssetId: assets.parentAssetId,
      manufacturer: assets.manufacturer,
      model: assets.model,
      serialNumber: assets.serialNumber,
      yearOfManufacture: assets.yearOfManufacture,
      assetClientId: sites.clientId,
    })
    .from(projectAssets)
    .innerJoin(projects, eq(projectAssets.projectId, projects.id))
    .innerJoin(projectTypes, eq(projects.projectTypeId, projectTypes.id))
    .innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.assetId, assetId)))
    .limit(1);

  if (!row || row.clientId !== row.assetClientId || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  const fieldRows = await db
    .select()
    .from(projectTypeFields)
    .where(eq(projectTypeFields.projectTypeId, row.projectTypeId))
    .orderBy(asc(projectTypeFields.sortOrder), asc(projectTypeFields.fieldKey));

  const fields: ConfiguredField[] = fieldRows.map((fieldRow) => {
    const definition = catalogByKey.get(catalogKey(fieldRow.source, fieldRow.fieldKey));
    return {
      source: fieldRow.source as ProjectTypeFieldSource,
      key: fieldRow.fieldKey,
      label: definition?.label ?? fieldRow.fieldKey,
      type: definition?.type ?? "text",
      required: fieldRow.required,
      sortOrder: fieldRow.sortOrder,
    };
  });

  return {
    projectId: row.projectId,
    projectTitle: row.projectTitle,
    projectReference: row.projectReference,
    projectTypeId: row.projectTypeId,
    projectTypeCode: row.projectTypeCode,
    projectTypeName: row.projectTypeName,
    clientId: row.clientId,
    asset: {
      id: row.assetId,
      locationId: row.locationId,
      assetTypeId: row.assetTypeId,
      tag: row.tag,
      assetName: row.assetName,
      quantity: row.quantity,
      unitOfMeasure: row.unitOfMeasure,
      status: row.status,
      nrm3Code: row.nrm3Code,
      parentAssetId: row.parentAssetId,
      manufacturer: row.manufacturer,
      model: row.model,
      serialNumber: row.serialNumber,
      yearOfManufacture: row.yearOfManufacture,
    },
    fields,
  } satisfies CaptureContext;
}

function groupConfiguredFields(fields: ConfiguredField[]) {
  return {
    asset: fields.filter((field) => field.source === "asset"),
    maintenance_history: fields.filter((field) => field.source === "maintenance_history"),
    survey_record: fields.filter((field) => field.source === "survey_record"),
  };
}

function assetValueMap(asset: CaptureContext["asset"]): Record<string, unknown> {
  return {
    tag: asset.tag,
    assetName: asset.assetName,
    quantity: asset.quantity,
    unitOfMeasure: asset.unitOfMeasure,
    status: asset.status,
    locationId: asset.locationId,
    assetTypeId: asset.assetTypeId,
    nrm3Code: asset.nrm3Code,
    parentAssetId: asset.parentAssetId,
    manufacturer: asset.manufacturer,
    model: asset.model,
    serialNumber: asset.serialNumber,
    yearOfManufacture: asset.yearOfManufacture,
  };
}

async function buildAssetPatch(
  db: CaptureDb,
  user: AuthUser,
  context: CaptureContext,
  values: Record<string, unknown>,
  configured: ConfiguredField[],
): Promise<{ ok: true; patch: Record<string, unknown> } | { ok: false; status: 400 | 404; error: string }> {
  const configuredKeys = new Set(configured.map((field) => field.key));
  const patch: Record<string, unknown> = {};

  for (const key of configuredKeys) {
    if (!ASSET_WRITABLE_KEYS.has(key) || !(key in values)) {
      continue;
    }

    const raw = values[key];

    if (key === "tag") {
      if (typeof raw !== "string" || raw.trim().length === 0 || raw.trim().length > 100) {
        return { ok: false, status: 400, error: "asset.tag is invalid." };
      }
      patch.tag = raw.trim();
      continue;
    }

    if (key === "status") {
      if (typeof raw !== "string" || !ASSET_STATUSES.includes(raw as (typeof ASSET_STATUSES)[number])) {
        return { ok: false, status: 400, error: "asset.status is invalid." };
      }
      patch.status = raw;
      continue;
    }

    if (key === "assetTypeId") {
      if (typeof raw !== "string" || !z.uuid().safeParse(raw).success) {
        return { ok: false, status: 400, error: "asset.assetTypeId is invalid." };
      }
      const [type] = await db.select({ id: assetTypes.id }).from(assetTypes).where(eq(assetTypes.id, raw)).limit(1);
      if (!type) {
        return { ok: false, status: 404, error: "Asset type not found." };
      }
      patch.assetTypeId = raw;
      continue;
    }

    if (key === "nrm3Code") {
      if (raw == null || (typeof raw === "string" && raw.trim().length === 0)) {
        patch.nrm3Code = null;
        continue;
      }
      if (typeof raw !== "string") {
        return { ok: false, status: 400, error: "asset.nrm3Code is invalid." };
      }
      const code = raw.trim();
      const [classification] = await db
        .select({ code: nrm3Classifications.code })
        .from(nrm3Classifications)
        .where(eq(nrm3Classifications.code, code))
        .limit(1);
      if (!classification) {
        return { ok: false, status: 404, error: "NRM3 classification not found." };
      }
      patch.nrm3Code = code;
      continue;
    }

    if (key === "parentAssetId") {
      if (raw == null || (typeof raw === "string" && raw.trim().length === 0)) {
        patch.parentAssetId = null;
        continue;
      }
      if (typeof raw !== "string" || !z.uuid().safeParse(raw).success) {
        return { ok: false, status: 400, error: "asset.parentAssetId is invalid." };
      }
      if (raw === context.asset.id) {
        return { ok: false, status: 400, error: "An asset cannot be its own parent." };
      }
      const [parent] = await db
        .select({ id: assets.id, clientId: sites.clientId })
        .from(assets)
        .innerJoin(locations, eq(assets.locationId, locations.id))
        .innerJoin(sites, eq(locations.siteId, sites.id))
        .where(eq(assets.id, raw))
        .limit(1);
      if (!parent || !(await clientIsVisible(db as Database, user, parent.clientId))) {
        return { ok: false, status: 404, error: "Parent asset not found." };
      }
      if (parent.clientId !== context.clientId) {
        return { ok: false, status: 400, error: "Parent asset must belong to the same client." };
      }
      patch.parentAssetId = raw;
      continue;
    }

    if (key === "quantity") {
      if (raw == null) {
        patch.quantity = null;
        continue;
      }
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return { ok: false, status: 400, error: "asset.quantity is invalid." };
      }
      patch.quantity = raw;
      continue;
    }

    if (key === "yearOfManufacture") {
      if (raw == null) {
        patch.yearOfManufacture = null;
        continue;
      }
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1000 || raw > 9999) {
        return { ok: false, status: 400, error: "asset.yearOfManufacture is invalid." };
      }
      patch.yearOfManufacture = raw;
      continue;
    }

    if (typeof raw !== "string" && raw != null) {
      return { ok: false, status: 400, error: `asset.${key} is invalid.` };
    }

    patch[key] = blankToNull(typeof raw === "string" ? raw : null);
  }

  return { ok: true, patch };
}

async function createMaintenanceHistoryFromCapture(
  db: CaptureDb,
  user: AuthUser,
  context: CaptureContext,
  values: Record<string, unknown>,
  configured: ConfiguredField[],
): Promise<{ ok: true; id: string } | { ok: false; status: 400 | 404; error: string }> {
  const allowed = new Set(configured.map((field) => field.key).filter((key) => !MH_SERVER_KEYS.has(key)));
  for (const key of MH_CREATE_REQUIRED_KEYS) {
    allowed.add(key);
  }

  const maintenanceTypeId = values.maintenanceTypeId;
  if (typeof maintenanceTypeId !== "string" || !z.uuid().safeParse(maintenanceTypeId).success) {
    return { ok: false, status: 400, error: "maintenance_history.maintenanceTypeId is invalid." };
  }

  const [maintenanceType] = await db
    .select({ id: maintenanceTypes.id })
    .from(maintenanceTypes)
    .where(eq(maintenanceTypes.id, maintenanceTypeId))
    .limit(1);

  if (!maintenanceType) {
    return { ok: false, status: 404, error: "Maintenance type not found." };
  }

  const performedAtRaw = values.performedAt;
  if (typeof performedAtRaw !== "string" || !isTimestamp(performedAtRaw)) {
    return { ok: false, status: 400, error: "maintenance_history.performedAt is invalid." };
  }

  const workDescriptionRaw = values.workDescription;
  if (typeof workDescriptionRaw !== "string" || workDescriptionRaw.trim().length === 0) {
    return { ok: false, status: 400, error: "maintenance_history.workDescription is invalid." };
  }

  let workOrderId: string | null = null;
  if (allowed.has("workOrderId") && "workOrderId" in values && values.workOrderId != null) {
    if (typeof values.workOrderId !== "string" || !z.uuid().safeParse(values.workOrderId).success) {
      return { ok: false, status: 400, error: "maintenance_history.workOrderId is invalid." };
    }
    const [workOrder] = await db
      .select({ id: workOrders.id, assetId: workOrders.assetId })
      .from(workOrders)
      .where(eq(workOrders.id, values.workOrderId))
      .limit(1);
    if (!workOrder) {
      return { ok: false, status: 404, error: "Work order not found." };
    }
    if (workOrder.assetId !== context.asset.id) {
      return { ok: false, status: 400, error: "Work order must belong to this asset." };
    }
    workOrderId = workOrder.id;
  }

  let performedBy: string | null = null;
  if (allowed.has("performedBy") && "performedBy" in values && values.performedBy != null) {
    if (typeof values.performedBy !== "string" || !z.uuid().safeParse(values.performedBy).success) {
      return { ok: false, status: 400, error: "maintenance_history.performedBy is invalid." };
    }
    const [performer] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, values.performedBy), eq(users.disabled, false)))
      .limit(1);
    if (!performer) {
      return { ok: false, status: 404, error: "Performer not found." };
    }
    performedBy = performer.id;
  }

  void user;

  const completedAt =
    allowed.has("completedAt") && "completedAt" in values ? timestampOrNull(values.completedAt) : null;

  if (allowed.has("completedAt") && "completedAt" in values && values.completedAt != null && completedAt == null) {
    if (!(typeof values.completedAt === "string" && values.completedAt.trim().length === 0)) {
      return { ok: false, status: 400, error: "maintenance_history.completedAt is invalid." };
    }
  }

  const nextRecommendedDate =
    allowed.has("nextRecommendedDate") && "nextRecommendedDate" in values
      ? calendarDateOrNull(values.nextRecommendedDate)
      : null;

  if (
    allowed.has("nextRecommendedDate") &&
    "nextRecommendedDate" in values &&
    values.nextRecommendedDate != null &&
    nextRecommendedDate == null &&
    !(typeof values.nextRecommendedDate === "string" && values.nextRecommendedDate.trim().length === 0)
  ) {
    return { ok: false, status: 400, error: "maintenance_history.nextRecommendedDate is invalid." };
  }

  const moneyOrError = (
    key: string,
  ): { ok: true; value: number | null } | { ok: false; error: string } => {
    if (!allowed.has(key) || !(key in values) || values[key] == null) {
      return { ok: true, value: null };
    }
    if (typeof values[key] !== "number" || !Number.isFinite(values[key])) {
      return { ok: false, error: `maintenance_history.${key} is invalid.` };
    }
    return { ok: true, value: values[key] as number };
  };

  const labourCost = moneyOrError("labourCost");
  if (!labourCost.ok) {
    return { ok: false, status: 400, error: labourCost.error };
  }
  const materialsCost = moneyOrError("materialsCost");
  if (!materialsCost.ok) {
    return { ok: false, status: 400, error: materialsCost.error };
  }
  const otherCost = moneyOrError("otherCost");
  if (!otherCost.ok) {
    return { ok: false, status: 400, error: otherCost.error };
  }

  const textField = (
    key: string,
    max: number,
  ): { ok: true; value: string | null } | { ok: false; error: string } => {
    if (!allowed.has(key) || !(key in values)) {
      return { ok: true, value: null };
    }
    if (values[key] == null) {
      return { ok: true, value: null };
    }
    if (typeof values[key] !== "string") {
      return { ok: false, error: `maintenance_history.${key} is invalid.` };
    }
    const trimmed = values[key].trim();
    if (trimmed.length > max) {
      return { ok: false, error: `maintenance_history.${key} is invalid.` };
    }
    return { ok: true, value: trimmed.length === 0 ? null : trimmed };
  };

  const findings = textField("findings", 5000);
  if (!findings.ok) {
    return { ok: false, status: 400, error: findings.error };
  }
  const actionsTaken = textField("actionsTaken", 5000);
  if (!actionsTaken.ok) {
    return { ok: false, status: 400, error: actionsTaken.error };
  }
  const notes = textField("notes", 5000);
  if (!notes.ok) {
    return { ok: false, status: 400, error: notes.error };
  }
  const conditionBefore = textField("conditionBefore", 30);
  if (!conditionBefore.ok) {
    return { ok: false, status: 400, error: conditionBefore.error };
  }
  const conditionAfter = textField("conditionAfter", 30);
  if (!conditionAfter.ok) {
    return { ok: false, status: 400, error: conditionAfter.error };
  }
  const outcome = textField("outcome", 30);
  if (!outcome.ok) {
    return { ok: false, status: 400, error: outcome.error };
  }

  const referenceNumber = await nextReference(db, context.clientId, "MH");
  const [created] = await db
    .insert(maintenanceHistory)
    .values({
      assetId: context.asset.id,
      workOrderId,
      maintenanceTypeId,
      performedBy,
      referenceNumber,
      performedAt: new Date(performedAtRaw),
      completedAt,
      workDescription: workDescriptionRaw.trim(),
      findings: findings.value,
      actionsTaken: actionsTaken.value,
      conditionBefore: conditionBefore.value,
      conditionAfter: conditionAfter.value,
      outcome: outcome.value,
      labourCost: labourCost.value,
      materialsCost: materialsCost.value,
      otherCost: otherCost.value,
      nextRecommendedDate,
      notes: notes.value,
    })
    .returning({ id: maintenanceHistory.id });

  if (!created) {
    throw new Error("Maintenance history was not created.");
  }

  return { ok: true, id: created.id };
}

async function upsertSurveyFromCapture(
  db: CaptureDb,
  context: CaptureContext,
  values: Record<string, unknown>,
  configured: ConfiguredField[],
): Promise<
  { ok: true; id: string; created: boolean } | { ok: false; status: 400 | 404; error: string }
> {
  const allowed = new Set(configured.map((field) => field.key));
  const [existing] = await db
    .select({ id: surveyRecords.id })
    .from(surveyRecords)
    .where(and(eq(surveyRecords.projectId, context.projectId), eq(surveyRecords.assetId, context.asset.id)))
    .limit(1);

  const parsed = parseSurveyValues(values, allowed);

  if ("error" in parsed) {
    return { ok: false, status: 400, error: parsed.error };
  }

  let surveyorIds: string[] | undefined;
  if (allowed.has("surveyorUserIds") && "surveyorUserIds" in values) {
    const ids = parseUuidList(values.surveyorUserIds);
    if (!ids) {
      return { ok: false, status: 400, error: "survey_record.surveyorUserIds is invalid." };
    }
    const unique = [...new Set(ids)];
    if (unique.length > 0) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, unique), eq(users.disabled, false)));
      if (rows.length !== unique.length) {
        return { ok: false, status: 404, error: "Surveyor not found." };
      }
    }
    surveyorIds = unique;
  }

  if (existing) {
    await db
      .update(surveyRecords)
      .set({ ...parsed.values, updatedAt: new Date() })
      .where(eq(surveyRecords.id, existing.id));

    if (surveyorIds) {
      await db.delete(surveyRecordUsers).where(eq(surveyRecordUsers.surveyRecordId, existing.id));
      if (surveyorIds.length > 0) {
        await db.insert(surveyRecordUsers).values(
          surveyorIds.map((userId) => ({
            surveyRecordId: existing.id,
            projectId: context.projectId,
            userId,
          })),
        );
      }
    }

    return { ok: true, id: existing.id, created: false };
  }

  const [created] = await db
    .insert(surveyRecords)
    .values({
      projectId: context.projectId,
      assetId: context.asset.id,
      status: "not_started",
      furtherInvestigationRequired: false,
      resurveyRequired: false,
      ...parsed.values,
    })
    .returning({ id: surveyRecords.id });

  if (!created) {
    throw new Error("Survey record was not created.");
  }

  if (surveyorIds && surveyorIds.length > 0) {
    await db.insert(surveyRecordUsers).values(
      surveyorIds.map((userId) => ({
        surveyRecordId: created.id,
        projectId: context.projectId,
        userId,
      })),
    );
  }

  return { ok: true, id: created.id, created: true };
}

function parseSurveyValues(
  values: Record<string, unknown>,
  allowed: Set<string>,
): { values: Record<string, unknown> } | { error: string } {
  const out: Record<string, unknown> = {};

  if (allowed.has("status") && "status" in values) {
    if (typeof values.status !== "string" || !SURVEY_RECORD_STATUSES.includes(values.status as never)) {
      return { error: "survey_record.status is invalid." };
    }
    out.status = values.status;
  }

  if (allowed.has("surveyedAt") && "surveyedAt" in values) {
    if (values.surveyedAt == null || (typeof values.surveyedAt === "string" && values.surveyedAt.trim().length === 0)) {
      out.surveyedAt = null;
    } else if (typeof values.surveyedAt === "string" && isTimestamp(values.surveyedAt)) {
      out.surveyedAt = new Date(values.surveyedAt);
    } else {
      return { error: "survey_record.surveyedAt is invalid." };
    }
  }

  if (allowed.has("conditionCode") && "conditionCode" in values) {
    if (values.conditionCode == null || values.conditionCode === "") {
      out.conditionCode = null;
    } else if (
      typeof values.conditionCode === "string" &&
      SURVEY_CONDITION_CODES.includes(values.conditionCode as never)
    ) {
      out.conditionCode = values.conditionCode;
    } else {
      return { error: "survey_record.conditionCode is invalid." };
    }
  }

  for (const key of ["componentDescription", "unitOfMeasure", "observations", "defectDetails", "comments"] as const) {
    if (!allowed.has(key) || !(key in values)) {
      continue;
    }
    if (values[key] == null) {
      out[key] = null;
      continue;
    }
    if (typeof values[key] !== "string") {
      return { error: `survey_record.${key} is invalid.` };
    }
    out[key] = blankToNull(values[key]);
  }

  for (const key of [
    "estimatedAssetAgeYears",
    "estimatedRemainingLifeYears",
    "riskConsequence",
    "riskLikelihood",
    "riskScore",
  ] as const) {
    if (!allowed.has(key) || !(key in values)) {
      continue;
    }
    if (values[key] == null) {
      out[key] = null;
      continue;
    }
    if (typeof values[key] !== "number" || !Number.isInteger(values[key]) || values[key] < 0) {
      return { error: `survey_record.${key} is invalid.` };
    }
    out[key] = values[key];
  }

  if (allowed.has("quantityObserved") && "quantityObserved" in values) {
    if (values.quantityObserved == null) {
      out.quantityObserved = null;
    } else if (
      typeof values.quantityObserved === "number" &&
      Number.isFinite(values.quantityObserved) &&
      values.quantityObserved >= 0
    ) {
      out.quantityObserved = values.quantityObserved;
    } else {
      return { error: "survey_record.quantityObserved is invalid." };
    }
  }

  for (const key of ["furtherInvestigationRequired", "resurveyRequired"] as const) {
    if (!allowed.has(key) || !(key in values)) {
      continue;
    }
    if (typeof values[key] !== "boolean") {
      return { error: `survey_record.${key} is invalid.` };
    }
    out[key] = values[key];
  }

  if (
    !("riskScore" in values && allowed.has("riskScore")) &&
    typeof out.riskConsequence === "number" &&
    typeof out.riskLikelihood === "number"
  ) {
    out.riskScore = out.riskConsequence * out.riskLikelihood;
  }

  return { values: out };
}

function parseUuidList(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !z.uuid().safeParse(item).success) {
      return null;
    }
    ids.push(item);
  }
  return ids;
}

function isEmptyValue(value: unknown) {
  if (value == null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function blankToNull(value: string | null | undefined) {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function calendarDateOrNull(value: unknown) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return isCalendarDate(trimmed) ? trimmed : null;
}

function timestampOrNull(value: unknown) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return isTimestamp(trimmed) ? new Date(trimmed) : null;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}
