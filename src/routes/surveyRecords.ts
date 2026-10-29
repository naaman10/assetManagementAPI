import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible, clientVisibility } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { removeSurveyPhotos } from "../db/surveyPhotoObjects.js";
import {
  SURVEY_CONDITION_CODES,
  SURVEY_RECORD_STATUSES,
  assets,
  clients,
  locations,
  projectAssets,
  projects,
  sites,
  surveyRecordPhotos,
  surveyRecordUsers,
  surveyRecords,
  users,
} from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AssetStorage } from "../storage/assets.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS = 20;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const nonNegativeInt = z.number().int().min(0).nullable().optional();
const quantityObserved = z
  .number()
  .finite()
  .gte(0)
  .lte(9_999_999_999.999)
  .refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, {
    message: "Use at most 3 decimal places.",
  })
  .nullable()
  .optional();
const surveyedAt = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((value) => value == null || value.length === 0 || !Number.isNaN(Date.parse(value)), {
    message: "Enter a date and time.",
  });
const surveyorUserIds = z.array(z.uuid()).max(100);

const surveyFields = {
  status: z.enum(SURVEY_RECORD_STATUSES).optional(),
  surveyedAt,
  conditionCode: z.enum(SURVEY_CONDITION_CODES).nullable().optional(),
  componentDescription: optionalText(5000),
  estimatedAssetAgeYears: nonNegativeInt,
  estimatedRemainingLifeYears: nonNegativeInt,
  quantityObserved,
  unitOfMeasure: optionalText(30),
  observations: optionalText(5000),
  defectDetails: optionalText(5000),
  riskConsequence: nonNegativeInt,
  riskLikelihood: nonNegativeInt,
  riskScore: nonNegativeInt,
  furtherInvestigationRequired: z.boolean().optional(),
  resurveyRequired: z.boolean().optional(),
  comments: optionalText(5000),
  surveyorUserIds: surveyorUserIds.optional(),
};

const createSurveyRecordSchema = z.object({
  assetId: z.uuid(),
  ...surveyFields,
});

const updateSurveyRecordSchema = z
  .object(surveyFields)
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const surveyRecordRoutes = new Hono<AppEnv>();

surveyRecordRoutes.get("/survey-records", requireUser, async (c) => {
  const db = c.get("services").db;
  const rows = await surveyListQuery(db)
    .where(clientVisibility(db, c.get("user")))
    .orderBy(sql`${surveyRecords.surveyedAt} DESC NULLS LAST`, asc(surveyRecords.createdAt));
  const listed = await presentSurveyRecords(db, c.get("services").assets, rows);
  return c.json({ surveyRecordCount: listed.length, surveyRecords: listed });
});

surveyRecordRoutes.get("/projects/:id/survey-records", requireUser, async (c) => {
  const projectId = parseId(c.req.param("id"));

  if (!projectId) {
    return c.json({ error: "Project not found." }, 404);
  }

  const db = c.get("services").db;
  const project = await visibleProject(db, c.get("user"), projectId);

  if (!project) {
    return c.json({ error: "Project not found." }, 404);
  }

  const rows = await surveyListQuery(db)
    .where(eq(surveyRecords.projectId, projectId))
    .orderBy(sql`${surveyRecords.surveyedAt} DESC NULLS LAST`, asc(surveyRecords.createdAt));
  const listed = await presentSurveyRecords(db, c.get("services").assets, rows);
  return c.json({ surveyRecordCount: listed.length, surveyRecords: listed });
});

surveyRecordRoutes.post("/projects/:id/survey-records", requireUser, async (c) => {
  const projectId = parseId(c.req.param("id"));

  if (!projectId) {
    return c.json({ error: "Project not found." }, 404);
  }

  const parsed = createSurveyRecordSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const project = await visibleProject(db, user, projectId);

  if (!project) {
    return c.json({ error: "Project not found." }, 404);
  }

  const linked = await assetLinkedToProject(db, projectId, parsed.data.assetId, project.clientId);

  if (!linked) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const surveyorIds = await usersExist(db, parsed.data.surveyorUserIds ?? []);

  if (!surveyorIds) {
    return c.json({ error: "Surveyor not found." }, 404);
  }

  const values = surveyValuesFromBody(parsed.data);

  try {
    const [created] = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(surveyRecords)
        .values({
          projectId,
          assetId: parsed.data.assetId,
          ...values,
        })
        .returning({ id: surveyRecords.id });

      if (row && surveyorIds.length > 0) {
        await tx.insert(surveyRecordUsers).values(
          surveyorIds.map((userId) => ({
            surveyRecordId: row.id,
            projectId,
            userId,
          })),
        );
      }

      return [row];
    });

    if (!created) {
      throw new Error("Survey record was not created.");
    }

    const surveyRecord = await loadSurveyRecord(db, c.get("services").assets, user, created.id);

    if (!surveyRecord) {
      throw new Error("Survey record was not created.");
    }

    return c.json({ surveyRecord }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ error: "A survey record already exists for that asset on this project." }, 409);
    }

    return routeError(c, error);
  }
});

surveyRecordRoutes.get("/assets/:id/survey-records", requireUser, async (c) => {
  const assetId = parseId(c.req.param("id"));

  if (!assetId) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const db = c.get("services").db;
  const asset = await visibleAsset(db, c.get("user"), assetId);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const rows = await surveyListQuery(db)
    .where(eq(surveyRecords.assetId, assetId))
    .orderBy(sql`${surveyRecords.surveyedAt} DESC NULLS LAST`, asc(surveyRecords.createdAt));
  const listed = await presentSurveyRecords(db, c.get("services").assets, rows);
  return c.json({ surveyRecordCount: listed.length, surveyRecords: listed });
});

surveyRecordRoutes.get("/survey-records/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Survey record not found." }, 404);
  }

  const surveyRecord = await loadSurveyRecord(
    c.get("services").db,
    c.get("services").assets,
    c.get("user"),
    id,
  );

  if (!surveyRecord) {
    return c.json({ error: "Survey record not found." }, 404);
  }

  return c.json({ surveyRecord });
});

surveyRecordRoutes.patch("/survey-records/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Survey record not found." }, 404);
  }

  const parsed = updateSurveyRecordSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const storage = c.get("services").assets;
  const user = c.get("user");
  const current = await loadSurveyRecord(db, storage, user, id);

  if (!current) {
    return c.json({ error: "Survey record not found." }, 404);
  }

  const surveyorIds =
    parsed.data.surveyorUserIds === undefined ? null : await usersExist(db, parsed.data.surveyorUserIds);

  if (parsed.data.surveyorUserIds !== undefined && !surveyorIds) {
    return c.json({ error: "Surveyor not found." }, 404);
  }

  const patch = surveyValuesFromBody(parsed.data, current);

  await db.transaction(async (tx) => {
    await tx
      .update(surveyRecords)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(surveyRecords.id, id));

    if (surveyorIds) {
      await tx.delete(surveyRecordUsers).where(eq(surveyRecordUsers.surveyRecordId, id));

      if (surveyorIds.length > 0) {
        await tx.insert(surveyRecordUsers).values(
          surveyorIds.map((userId) => ({
            surveyRecordId: id,
            projectId: current.project.id,
            userId,
          })),
        );
      }
    }
  });

  return c.json({ surveyRecord: await loadSurveyRecord(db, storage, user, id) });
});

surveyRecordRoutes.delete("/survey-records/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Survey record not found." }, 404);
  }

  const db = c.get("services").db;
  const storage = c.get("services").assets;
  const current = await loadSurveyRecord(db, storage, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Survey record not found." }, 404);
  }

  try {
    await removeSurveyPhotos(db, storage, { surveyRecordId: id });
    await db.delete(surveyRecords).where(eq(surveyRecords.id, id));
  } catch (error) {
    return routeError(c, error);
  }

  return c.json({ ok: true });
});

surveyRecordRoutes.post("/survey-records/:id/photos", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Survey record not found." }, 404);
  }

  const db = c.get("services").db;
  const storage = c.get("services").assets;
  const current = await loadSurveyRecord(db, storage, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Survey record not found." }, 404);
  }

  let body: Record<string, unknown>;

  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "Invalid request" }, 400);
  }

  const photo = body.photo;

  if (!(photo instanceof File)) {
    return c.json({ error: "A photo image is required." }, 400);
  }

  if (photo.size > MAX_PHOTO_BYTES) {
    return c.json({ error: "Photo must be 10 MB or smaller." }, 400);
  }

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const contentType = imageType(bytes);

  if (!contentType) {
    return c.json({ error: "Photo must be a JPEG, PNG, or WebP image." }, 400);
  }

  const [existing] = await db
    .select({ value: count() })
    .from(surveyRecordPhotos)
    .where(eq(surveyRecordPhotos.surveyRecordId, id));

  if ((existing?.value ?? 0) >= MAX_PHOTOS) {
    return c.json({ error: "A survey record can have at most 20 photos." }, 400);
  }

  const photoId = crypto.randomUUID();
  let storageKey: string | null = null;

  try {
    storageKey = await storage.putSurveyPhoto(current.client.id, id, photoId, bytes, contentType);
    await db.insert(surveyRecordPhotos).values({
      id: photoId,
      surveyRecordId: id,
      storageKey,
      contentType,
    });
  } catch (error) {
    if (storageKey) {
      try {
        await storage.deleteObject(storageKey);
      } catch (cleanupError) {
        console.error("Failed to remove a survey photo after a failed upload", cleanupError);
      }
    }

    return routeError(c, error);
  }

  const saved = await presentSurveyPhoto(db, storage, photoId);

  if (!saved) {
    throw new Error("Survey record photo was not created.");
  }

  return c.json({ photo: saved }, 201);
});

surveyRecordRoutes.delete("/survey-records/:id/photos/:photoId", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));
  const photoId = parseId(c.req.param("photoId"));

  if (!id || !photoId) {
    return c.json({ error: "Photo not found." }, 404);
  }

  const db = c.get("services").db;
  const storage = c.get("services").assets;
  const current = await loadSurveyRecord(db, storage, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Photo not found." }, 404);
  }

  const [photo] = await db
    .select()
    .from(surveyRecordPhotos)
    .where(eq(surveyRecordPhotos.id, photoId))
    .limit(1);

  if (!photo || photo.surveyRecordId !== id) {
    return c.json({ error: "Photo not found." }, 404);
  }

  try {
    await storage.deleteObject(photo.storageKey);
    await db.delete(surveyRecordPhotos).where(eq(surveyRecordPhotos.id, photoId));
  } catch (error) {
    return routeError(c, error);
  }

  return c.json({ ok: true });
});

function surveyListQuery(db: Database) {
  return db
    .select({
      id: surveyRecords.id,
      projectId: surveyRecords.projectId,
      projectTitle: projects.title,
      projectReference: projects.projectReference,
      clientId: projects.clientId,
      assetId: surveyRecords.assetId,
      assetTag: assets.tag,
      assetName: assets.assetName,
      locationId: assets.locationId,
      status: surveyRecords.status,
      surveyedAt: surveyRecords.surveyedAt,
      conditionCode: surveyRecords.conditionCode,
      componentDescription: surveyRecords.componentDescription,
      estimatedAssetAgeYears: surveyRecords.estimatedAssetAgeYears,
      estimatedRemainingLifeYears: surveyRecords.estimatedRemainingLifeYears,
      quantityObserved: surveyRecords.quantityObserved,
      unitOfMeasure: surveyRecords.unitOfMeasure,
      observations: surveyRecords.observations,
      defectDetails: surveyRecords.defectDetails,
      riskConsequence: surveyRecords.riskConsequence,
      riskLikelihood: surveyRecords.riskLikelihood,
      riskScore: surveyRecords.riskScore,
      furtherInvestigationRequired: surveyRecords.furtherInvestigationRequired,
      resurveyRequired: surveyRecords.resurveyRequired,
      comments: surveyRecords.comments,
      createdAt: surveyRecords.createdAt,
      updatedAt: surveyRecords.updatedAt,
    })
    .from(surveyRecords)
    .innerJoin(projects, eq(surveyRecords.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .innerJoin(assets, eq(surveyRecords.assetId, assets.id));
}

async function loadSurveyRecord(db: Database, storage: AssetStorage, user: AuthUser, id: string) {
  const [row] = await surveyListQuery(db).where(eq(surveyRecords.id, id)).limit(1);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  const [surveyRecord] = await presentSurveyRecords(db, storage, [row]);
  return surveyRecord ?? null;
}

async function presentSurveyRecords(db: Database, storage: AssetStorage, rows: SurveyRow[]) {
  const ids = rows.map((row) => row.id);
  const surveyorRows =
    ids.length === 0
      ? []
      : await db
          .select({
            surveyRecordId: surveyRecordUsers.surveyRecordId,
            id: users.id,
            email: users.email,
            name: users.name,
          })
          .from(surveyRecordUsers)
          .innerJoin(users, eq(surveyRecordUsers.userId, users.id))
          .where(inArray(surveyRecordUsers.surveyRecordId, ids))
          .orderBy(asc(users.name), asc(users.email));

  const surveyorsByRecord = new Map<string, Surveyor[]>();

  for (const row of surveyorRows) {
    const list = surveyorsByRecord.get(row.surveyRecordId) ?? [];
    list.push({ id: row.id, email: row.email, name: row.name });
    surveyorsByRecord.set(row.surveyRecordId, list);
  }

  const photosByRecord = new Map<string, SurveyPhoto[]>();

  if (ids.length > 0) {
    const stored = await db
      .select({
        id: surveyRecordPhotos.id,
        surveyRecordId: surveyRecordPhotos.surveyRecordId,
        storageKey: surveyRecordPhotos.storageKey,
        contentType: surveyRecordPhotos.contentType,
        createdAt: surveyRecordPhotos.createdAt,
      })
      .from(surveyRecordPhotos)
      .where(inArray(surveyRecordPhotos.surveyRecordId, ids))
      .orderBy(asc(surveyRecordPhotos.createdAt));

    for (const photo of stored) {
      const url = await storage.photoUrl(photo.storageKey);

      if (!url) {
        continue;
      }

      const list = photosByRecord.get(photo.surveyRecordId) ?? [];
      list.push({
        id: photo.id,
        url,
        contentType: photo.contentType,
        createdAt: photo.createdAt,
      });
      photosByRecord.set(photo.surveyRecordId, list);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    project: {
      id: row.projectId,
      title: row.projectTitle,
      projectReference: row.projectReference,
    },
    client: { id: row.clientId },
    assetId: row.assetId,
    asset: {
      id: row.assetId,
      tag: row.assetTag,
      assetName: row.assetName,
      locationId: row.locationId,
    },
    status: row.status,
    surveyedAt: row.surveyedAt,
    conditionCode: row.conditionCode,
    componentDescription: row.componentDescription,
    estimatedAssetAgeYears: row.estimatedAssetAgeYears,
    estimatedRemainingLifeYears: row.estimatedRemainingLifeYears,
    quantityObserved: row.quantityObserved,
    unitOfMeasure: row.unitOfMeasure,
    observations: row.observations,
    defectDetails: row.defectDetails,
    riskConsequence: row.riskConsequence,
    riskLikelihood: row.riskLikelihood,
    riskScore: row.riskScore,
    furtherInvestigationRequired: row.furtherInvestigationRequired,
    resurveyRequired: row.resurveyRequired,
    comments: row.comments,
    surveyors: surveyorsByRecord.get(row.id) ?? [],
    photos: photosByRecord.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function presentSurveyPhoto(db: Database, storage: AssetStorage, photoId: string) {
  const [photo] = await db
    .select()
    .from(surveyRecordPhotos)
    .where(eq(surveyRecordPhotos.id, photoId))
    .limit(1);

  if (!photo) {
    return null;
  }

  const url = await storage.photoUrl(photo.storageKey);

  if (!url) {
    return null;
  }

  return {
    id: photo.id,
    url,
    contentType: photo.contentType,
    createdAt: photo.createdAt,
  };
}

type SurveyPhoto = {
  id: string;
  url: string;
  contentType: string;
  createdAt: Date;
};

function surveyValuesFromBody(
  data: z.infer<typeof createSurveyRecordSchema> | z.infer<typeof updateSurveyRecordSchema>,
  current?: {
    status: string;
    surveyedAt: Date | null;
    conditionCode: string | null;
    componentDescription: string | null;
    estimatedAssetAgeYears: number | null;
    estimatedRemainingLifeYears: number | null;
    quantityObserved: number | null;
    unitOfMeasure: string | null;
    observations: string | null;
    defectDetails: string | null;
    riskConsequence: number | null;
    riskLikelihood: number | null;
    riskScore: number | null;
    furtherInvestigationRequired: boolean;
    resurveyRequired: boolean;
    comments: string | null;
  },
) {
  const status = data.status ?? current?.status ?? "not_started";
  const surveyedAtValue =
    data.surveyedAt === undefined
      ? (current?.surveyedAt ?? null)
      : data.surveyedAt == null || data.surveyedAt.length === 0
        ? null
        : new Date(data.surveyedAt);
  const conditionCode =
    data.conditionCode === undefined ? (current?.conditionCode ?? null) : data.conditionCode;
  const componentDescription =
    data.componentDescription === undefined
      ? (current?.componentDescription ?? null)
      : blankToNull(data.componentDescription);
  const estimatedAssetAgeYears =
    data.estimatedAssetAgeYears === undefined
      ? (current?.estimatedAssetAgeYears ?? null)
      : data.estimatedAssetAgeYears;
  const estimatedRemainingLifeYears =
    data.estimatedRemainingLifeYears === undefined
      ? (current?.estimatedRemainingLifeYears ?? null)
      : data.estimatedRemainingLifeYears;
  const quantity =
    data.quantityObserved === undefined ? (current?.quantityObserved ?? null) : data.quantityObserved;
  const unitOfMeasure =
    data.unitOfMeasure === undefined ? (current?.unitOfMeasure ?? null) : blankToNull(data.unitOfMeasure);
  const observations =
    data.observations === undefined ? (current?.observations ?? null) : blankToNull(data.observations);
  const defectDetails =
    data.defectDetails === undefined ? (current?.defectDetails ?? null) : blankToNull(data.defectDetails);
  const riskConsequence =
    data.riskConsequence === undefined ? (current?.riskConsequence ?? null) : data.riskConsequence;
  const riskLikelihood =
    data.riskLikelihood === undefined ? (current?.riskLikelihood ?? null) : data.riskLikelihood;
  let riskScore = data.riskScore === undefined ? (current?.riskScore ?? null) : data.riskScore;

  if (data.riskScore === undefined && riskConsequence != null && riskLikelihood != null) {
    riskScore = riskConsequence * riskLikelihood;
  }

  return {
    status,
    surveyedAt: surveyedAtValue,
    conditionCode,
    componentDescription,
    estimatedAssetAgeYears,
    estimatedRemainingLifeYears,
    quantityObserved: quantity,
    unitOfMeasure,
    observations,
    defectDetails,
    riskConsequence,
    riskLikelihood,
    riskScore,
    furtherInvestigationRequired:
      data.furtherInvestigationRequired ?? current?.furtherInvestigationRequired ?? false,
    resurveyRequired: data.resurveyRequired ?? current?.resurveyRequired ?? false,
    comments: data.comments === undefined ? (current?.comments ?? null) : blankToNull(data.comments),
  };
}

async function visibleProject(db: Database, user: AuthUser, projectId: string) {
  const [project] = await db
    .select({ id: projects.id, clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project || !(await clientIsVisible(db, user, project.clientId))) {
    return null;
  }

  return project;
}

async function visibleAsset(db: Database, user: AuthUser, assetId: string) {
  const [asset] = await db
    .select({ id: assets.id, clientId: sites.clientId })
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(eq(assets.id, assetId))
    .limit(1);

  if (!asset || !(await clientIsVisible(db, user, asset.clientId))) {
    return null;
  }

  return asset;
}

async function assetLinkedToProject(db: Database, projectId: string, assetId: string, clientId: string) {
  const [row] = await db
    .select({ assetId: projectAssets.assetId })
    .from(projectAssets)
    .innerJoin(assets, eq(projectAssets.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(
      and(
        eq(projectAssets.projectId, projectId),
        eq(projectAssets.assetId, assetId),
        eq(sites.clientId, clientId),
      ),
    )
    .limit(1);

  return Boolean(row);
}

async function usersExist(db: Database, ids: string[]) {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    return unique;
  }

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, unique), eq(users.disabled, false)));

  return rows.length === unique.length ? unique : null;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("code" in error && error.code === "23505") {
    return true;
  }

  if ("cause" in error) {
    return isUniqueViolation(error.cause);
  }

  return false;
}

type SurveyRow = {
  id: string;
  projectId: string;
  projectTitle: string;
  projectReference: string;
  clientId: string;
  assetId: string;
  assetTag: string;
  assetName: string | null;
  locationId: string;
  status: string;
  surveyedAt: Date | null;
  conditionCode: string | null;
  componentDescription: string | null;
  estimatedAssetAgeYears: number | null;
  estimatedRemainingLifeYears: number | null;
  quantityObserved: number | null;
  unitOfMeasure: string | null;
  observations: string | null;
  defectDetails: string | null;
  riskConsequence: number | null;
  riskLikelihood: number | null;
  riskScore: number | null;
  furtherInvestigationRequired: boolean;
  resurveyRequired: boolean;
  comments: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type Surveyor = {
  id: string;
  email: string;
  name: string | null;
};

function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function blankToNull(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function imageType(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}
