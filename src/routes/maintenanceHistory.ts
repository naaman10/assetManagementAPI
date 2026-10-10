import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible, clientVisibility } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { removeHistoryPhotos } from "../db/historyPhotoObjects.js";
import { nextReference } from "../db/nextReference.js";
import { assets, clients, locations, maintenanceHistory, maintenanceHistoryPhotos, maintenanceTypes, sites, users, workOrders } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AssetStorage } from "../storage/assets.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const workDescription = z.string().trim().min(1).max(5000);
const optionalText = z.string().trim().max(5000).nullable().optional();
const shortText = z.string().trim().max(30).nullable().optional();
const money = z
  .number()
  .finite()
  .gte(-9_999_999_999.99)
  .lte(9_999_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: "Use at most 2 decimal places.",
  })
  .nullable()
  .optional();
const calendarDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((value) => value == null || value.length === 0 || isCalendarDate(value), {
    message: "Enter a date as YYYY-MM-DD.",
  });
const timestamp = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((value) => value == null || value.length === 0 || isTimestamp(value), {
    message: "Enter a date and time.",
  });
const requiredTimestamp = z.string().trim().refine(isTimestamp, { message: "Enter a date and time." });
const optionalId = z.uuid().nullable().optional();
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS = 20;

const createHistorySchema = z.object({
  maintenanceTypeId: z.uuid(),
  workOrderId: optionalId,
  performedAt: requiredTimestamp,
  completedAt: timestamp,
  performedBy: optionalId,
  workDescription,
  findings: optionalText,
  actionsTaken: optionalText,
  conditionBefore: shortText,
  conditionAfter: shortText,
  outcome: shortText,
  labourCost: money,
  materialsCost: money,
  otherCost: money,
  nextRecommendedDate: calendarDate,
  notes: optionalText,
});

const updateHistorySchema = z
  .object({
    maintenanceTypeId: z.uuid().optional(),
    workOrderId: optionalId,
    performedAt: requiredTimestamp.optional(),
    completedAt: timestamp,
    performedBy: optionalId,
    workDescription: workDescription.optional(),
    findings: optionalText,
    actionsTaken: optionalText,
    conditionBefore: shortText,
    conditionAfter: shortText,
    outcome: shortText,
    labourCost: money,
    materialsCost: money,
    otherCost: money,
    nextRecommendedDate: calendarDate,
    notes: optionalText,
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const maintenanceHistoryRoutes = new Hono<AppEnv>();

maintenanceHistoryRoutes.get("/assets/:id/maintenance-history", requireUser, async (c) => {
  const assetId = parseId(c.req.param("id"));

  if (!assetId) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const db = c.get("services").db;
  const asset = await visibleAsset(db, c.get("user"), assetId);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const rows = await historyForAsset(db, c.get("services").assets, assetId);
  return c.json({ maintenanceHistoryCount: rows.length, maintenanceHistories: rows });
});

maintenanceHistoryRoutes.post("/assets/:id/maintenance-history", requireUser, async (c) => {
  const assetId = parseId(c.req.param("id"));

  if (!assetId) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const parsed = createHistorySchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const asset = await visibleAsset(db, user, assetId);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  if (!(await maintenanceTypeExists(db, parsed.data.maintenanceTypeId))) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  const workOrder = await resolveWorkOrder(db, user, assetId, parsed.data.workOrderId ?? null);

  if ("error" in workOrder) {
    return c.json({ error: workOrder.error }, workOrder.status);
  }

  const performedBy = parsed.data.performedBy ?? null;

  if (performedBy && !(await userExists(db, performedBy))) {
    return c.json({ error: "Performer not found." }, 404);
  }

  const [created] = await db.transaction(async (tx) => {
    const referenceNumber = await nextReference(tx, asset.clientId, "MH");

    return tx
      .insert(maintenanceHistory)
      .values({
        assetId,
        workOrderId: workOrder.workOrderId,
        maintenanceTypeId: parsed.data.maintenanceTypeId,
        performedBy,
        referenceNumber,
        performedAt: new Date(parsed.data.performedAt),
        completedAt: timestampOrNull(parsed.data.completedAt),
        workDescription: parsed.data.workDescription,
        findings: blankToNull(parsed.data.findings),
        actionsTaken: blankToNull(parsed.data.actionsTaken),
        conditionBefore: blankToNull(parsed.data.conditionBefore),
        conditionAfter: blankToNull(parsed.data.conditionAfter),
        outcome: blankToNull(parsed.data.outcome),
        labourCost: parsed.data.labourCost ?? null,
        materialsCost: parsed.data.materialsCost ?? null,
        otherCost: parsed.data.otherCost ?? null,
        nextRecommendedDate: blankToNull(parsed.data.nextRecommendedDate),
        notes: blankToNull(parsed.data.notes),
      })
      .returning({ id: maintenanceHistory.id });
  });

  if (!created) {
    throw new Error("Maintenance history was not created.");
  }

  const record = await loadHistory(db, c.get("services").assets, user, created.id);

  if (!record) {
    throw new Error("Maintenance history was not created.");
  }

  return c.json({ maintenanceHistory: record }, 201);
});

maintenanceHistoryRoutes.get("/maintenance-history", requireUser, async (c) => {
  const db = c.get("services").db;
  const rows = await historyQuery(db)
    .where(clientVisibility(db, c.get("user")))
    .orderBy(desc(maintenanceHistory.performedAt), desc(maintenanceHistory.referenceNumber));

  return c.json({
    maintenanceHistoryCount: rows.length,
    maintenanceHistories: await presentHistories(db, c.get("services").assets, rows),
  });
});

maintenanceHistoryRoutes.get("/maintenance-history/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Maintenance history not found." }, 404);
  }

  const record = await loadHistory(c.get("services").db, c.get("services").assets, c.get("user"), id);

  if (!record) {
    return c.json({ error: "Maintenance history not found." }, 404);
  }

  return c.json({ maintenanceHistory: record });
});

maintenanceHistoryRoutes.patch("/maintenance-history/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Maintenance history not found." }, 404);
  }

  const parsed = updateHistorySchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const current = await loadHistory(db, c.get("services").assets, user, id);

  if (!current) {
    return c.json({ error: "Maintenance history not found." }, 404);
  }

  if (parsed.data.maintenanceTypeId && !(await maintenanceTypeExists(db, parsed.data.maintenanceTypeId))) {
    return c.json({ error: "Maintenance type not found." }, 404);
  }

  const workOrderId = parsed.data.workOrderId === undefined ? current.workOrderId : parsed.data.workOrderId;
  const workOrder = await resolveWorkOrder(db, user, current.assetId, workOrderId);

  if ("error" in workOrder) {
    return c.json({ error: workOrder.error }, workOrder.status);
  }

  const performedBy = parsed.data.performedBy === undefined ? current.performedBy : parsed.data.performedBy;

  if (performedBy && !(await userExists(db, performedBy))) {
    return c.json({ error: "Performer not found." }, 404);
  }

  await db
    .update(maintenanceHistory)
    .set({
      maintenanceTypeId: parsed.data.maintenanceTypeId ?? current.maintenanceTypeId,
      workOrderId: workOrder.workOrderId,
      performedBy,
      performedAt: parsed.data.performedAt === undefined ? current.performedAt : new Date(parsed.data.performedAt),
      completedAt: parsed.data.completedAt === undefined ? current.completedAt : timestampOrNull(parsed.data.completedAt),
      workDescription: parsed.data.workDescription ?? current.workDescription,
      findings: parsed.data.findings === undefined ? current.findings : blankToNull(parsed.data.findings),
      actionsTaken: parsed.data.actionsTaken === undefined ? current.actionsTaken : blankToNull(parsed.data.actionsTaken),
      conditionBefore: parsed.data.conditionBefore === undefined ? current.conditionBefore : blankToNull(parsed.data.conditionBefore),
      conditionAfter: parsed.data.conditionAfter === undefined ? current.conditionAfter : blankToNull(parsed.data.conditionAfter),
      outcome: parsed.data.outcome === undefined ? current.outcome : blankToNull(parsed.data.outcome),
      labourCost: parsed.data.labourCost === undefined ? current.labourCost : parsed.data.labourCost,
      materialsCost: parsed.data.materialsCost === undefined ? current.materialsCost : parsed.data.materialsCost,
      otherCost: parsed.data.otherCost === undefined ? current.otherCost : parsed.data.otherCost,
      nextRecommendedDate:
        parsed.data.nextRecommendedDate === undefined ? current.nextRecommendedDate : blankToNull(parsed.data.nextRecommendedDate),
      notes: parsed.data.notes === undefined ? current.notes : blankToNull(parsed.data.notes),
      updatedAt: new Date(),
    })
    .where(eq(maintenanceHistory.id, id));

  return c.json({ maintenanceHistory: await loadHistory(db, c.get("services").assets, user, id) });
});

maintenanceHistoryRoutes.delete("/maintenance-history/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Maintenance history not found." }, 404);
  }

  const db = c.get("services").db;
  const storage = c.get("services").assets;
  const current = await loadHistory(db, storage, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Maintenance history not found." }, 404);
  }

  try {
    await removeHistoryPhotos(db, storage, { historyId: id });
    await db.delete(maintenanceHistory).where(eq(maintenanceHistory.id, id));
  } catch (error) {
    return routeError(c, error);
  }

  return c.json({ ok: true });
});

maintenanceHistoryRoutes.post("/maintenance-history/:id/photos", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Maintenance history not found." }, 404);
  }

  const db = c.get("services").db;
  const storage = c.get("services").assets;
  const current = await loadHistory(db, storage, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Maintenance history not found." }, 404);
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
    .from(maintenanceHistoryPhotos)
    .where(eq(maintenanceHistoryPhotos.maintenanceHistoryId, id));

  if ((existing?.value ?? 0) >= MAX_PHOTOS) {
    return c.json({ error: "A maintenance history record can have at most 20 photos." }, 400);
  }

  const photoId = crypto.randomUUID();
  let storageKey: string | null = null;

  try {
    storageKey = await storage.putHistoryPhoto(current.client.id, id, photoId, bytes, contentType);
    await db.insert(maintenanceHistoryPhotos).values({
      id: photoId,
      maintenanceHistoryId: id,
      storageKey,
      contentType,
    });
  } catch (error) {
    if (storageKey) {
      try {
        await storage.deleteObject(storageKey);
      } catch (cleanupError) {
        console.error("Failed to remove a history photo after a failed upload", cleanupError);
      }
    }

    return routeError(c, error);
  }

  const saved = await presentPhoto(db, storage, photoId);

  if (!saved) {
    throw new Error("Maintenance history photo was not created.");
  }

  return c.json({ photo: saved }, 201);
});

maintenanceHistoryRoutes.delete("/maintenance-history/:id/photos/:photoId", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));
  const photoId = parseId(c.req.param("photoId"));

  if (!id || !photoId) {
    return c.json({ error: "Photo not found." }, 404);
  }

  const db = c.get("services").db;
  const storage = c.get("services").assets;
  const current = await loadHistory(db, storage, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Photo not found." }, 404);
  }

  const [photo] = await db
    .select()
    .from(maintenanceHistoryPhotos)
    .where(eq(maintenanceHistoryPhotos.id, photoId))
    .limit(1);

  if (!photo || photo.maintenanceHistoryId !== id) {
    return c.json({ error: "Photo not found." }, 404);
  }

  try {
    await storage.deleteObject(photo.storageKey);
    await db.delete(maintenanceHistoryPhotos).where(eq(maintenanceHistoryPhotos.id, photoId));
  } catch (error) {
    return routeError(c, error);
  }

  return c.json({ ok: true });
});

const historyColumns = {
  id: maintenanceHistory.id,
  assetId: maintenanceHistory.assetId,
  assetRef: assets.assetRef,
  assetName: assets.assetName,
  locationId: locations.id,
  siteId: locations.siteId,
  locationCode: locations.locationCode,
  locationName: locations.name,
  clientId: clients.id,
  clientName: clients.name,
  workOrderId: maintenanceHistory.workOrderId,
  workOrderReference: workOrders.reference,
  workOrderTitle: workOrders.title,
  maintenanceTypeId: maintenanceHistory.maintenanceTypeId,
  maintenanceTypeCode: maintenanceTypes.code,
  maintenanceTypeName: maintenanceTypes.name,
  performedBy: maintenanceHistory.performedBy,
  performerEmail: users.email,
  performerName: users.name,
  referenceNumber: maintenanceHistory.referenceNumber,
  performedAt: maintenanceHistory.performedAt,
  completedAt: maintenanceHistory.completedAt,
  workDescription: maintenanceHistory.workDescription,
  findings: maintenanceHistory.findings,
  actionsTaken: maintenanceHistory.actionsTaken,
  conditionBefore: maintenanceHistory.conditionBefore,
  conditionAfter: maintenanceHistory.conditionAfter,
  outcome: maintenanceHistory.outcome,
  labourCost: maintenanceHistory.labourCost,
  materialsCost: maintenanceHistory.materialsCost,
  otherCost: maintenanceHistory.otherCost,
  nextRecommendedDate: maintenanceHistory.nextRecommendedDate,
  notes: maintenanceHistory.notes,
  createdAt: maintenanceHistory.createdAt,
  updatedAt: maintenanceHistory.updatedAt,
};

function historyQuery(db: Database) {
  return db
    .select(historyColumns)
    .from(maintenanceHistory)
    .innerJoin(assets, eq(maintenanceHistory.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .innerJoin(clients, eq(sites.clientId, clients.id))
    .innerJoin(maintenanceTypes, eq(maintenanceHistory.maintenanceTypeId, maintenanceTypes.id))
    .leftJoin(workOrders, eq(maintenanceHistory.workOrderId, workOrders.id))
    .leftJoin(users, eq(maintenanceHistory.performedBy, users.id));
}

async function historyForAsset(db: Database, storage: AssetStorage, assetId: string) {
  const rows = await historyQuery(db)
    .where(eq(maintenanceHistory.assetId, assetId))
    .orderBy(desc(maintenanceHistory.performedAt), desc(maintenanceHistory.referenceNumber));

  return presentHistories(db, storage, rows);
}

async function loadHistory(db: Database, storage: AssetStorage, user: AuthUser, id: string) {
  const [row] = await historyQuery(db).where(eq(maintenanceHistory.id, id)).limit(1);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  const [record] = await presentHistories(db, storage, [row]);
  return record ?? null;
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

async function resolveWorkOrder(db: Database, user: AuthUser, assetId: string, workOrderId: string | null) {
  if (!workOrderId) {
    return { workOrderId: null };
  }

  const [workOrder] = await db
    .select({ id: workOrders.id, assetId: workOrders.assetId, clientId: sites.clientId })
    .from(workOrders)
    .innerJoin(assets, eq(workOrders.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(eq(workOrders.id, workOrderId))
    .limit(1);

  if (!workOrder || !(await clientIsVisible(db, user, workOrder.clientId))) {
    return { status: 404 as const, error: "Work order not found." };
  }

  if (workOrder.assetId !== assetId) {
    return { status: 400 as const, error: "That work order belongs to another asset." };
  }

  return { workOrderId: workOrder.id };
}

async function maintenanceTypeExists(db: Database, id: string) {
  const [row] = await db.select({ id: maintenanceTypes.id }).from(maintenanceTypes).where(eq(maintenanceTypes.id, id)).limit(1);
  return Boolean(row);
}

async function userExists(db: Database, id: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return Boolean(row);
}

async function presentHistories(
  db: Database,
  storage: AssetStorage,
  rows: Parameters<typeof presentHistory>[0][],
) {
  const photos = new Map<string, HistoryPhoto[]>();

  if (rows.length > 0) {
    const stored = await db
      .select()
      .from(maintenanceHistoryPhotos)
      .where(
        inArray(
          maintenanceHistoryPhotos.maintenanceHistoryId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(maintenanceHistoryPhotos.createdAt));

    for (const photo of stored) {
      const url = await storage.photoUrl(photo.storageKey);

      if (!url) {
        continue;
      }

      const list = photos.get(photo.maintenanceHistoryId) ?? [];
      list.push({
        id: photo.id,
        url,
        contentType: photo.contentType,
        createdAt: photo.createdAt,
      });
      photos.set(photo.maintenanceHistoryId, list);
    }
  }

  return rows.map((row) => presentHistory(row, photos.get(row.id) ?? []));
}

async function presentPhoto(db: Database, storage: AssetStorage, photoId: string) {
  const [photo] = await db
    .select()
    .from(maintenanceHistoryPhotos)
    .where(eq(maintenanceHistoryPhotos.id, photoId))
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

type HistoryPhoto = {
  id: string;
  url: string;
  contentType: string;
  createdAt: Date;
};

function presentHistory(row: {
  id: string;
  assetId: string;
  assetRef: string;
  assetName: string | null;
  locationId: string;
  siteId: string;
  locationCode: string | null;
  locationName: string | null;
  clientId: string;
  clientName: string;
  workOrderId: string | null;
  workOrderReference: string | null;
  workOrderTitle: string | null;
  maintenanceTypeId: string;
  maintenanceTypeCode: string;
  maintenanceTypeName: string;
  performedBy: string | null;
  performerEmail: string | null;
  performerName: string | null;
  referenceNumber: string;
  performedAt: Date;
  completedAt: Date | null;
  workDescription: string;
  findings: string | null;
  actionsTaken: string | null;
  conditionBefore: string | null;
  conditionAfter: string | null;
  outcome: string | null;
  labourCost: number | null;
  materialsCost: number | null;
  otherCost: number | null;
  nextRecommendedDate: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}, photos: HistoryPhoto[]) {
  return {
    id: row.id,
    assetId: row.assetId,
    asset: {
      id: row.assetId,
      assetRef: row.assetRef,
      assetName: row.assetName,
      locationId: row.locationId,
    },
    location: {
      id: row.locationId,
      siteId: row.siteId,
      locationCode: row.locationCode,
      name: row.locationName,
    },
    client: {
      id: row.clientId,
      name: row.clientName,
    },
    workOrderId: row.workOrderId,
    workOrder:
      row.workOrderId && row.workOrderTitle
        ? { id: row.workOrderId, reference: row.workOrderReference, title: row.workOrderTitle }
        : null,
    maintenanceTypeId: row.maintenanceTypeId,
    maintenanceType: {
      id: row.maintenanceTypeId,
      code: row.maintenanceTypeCode,
      name: row.maintenanceTypeName,
    },
    performedBy: row.performedBy,
    performer: row.performedBy && row.performerEmail ? { id: row.performedBy, email: row.performerEmail, name: row.performerName } : null,
    referenceNumber: row.referenceNumber,
    performedAt: row.performedAt,
    completedAt: row.completedAt,
    workDescription: row.workDescription,
    findings: row.findings,
    actionsTaken: row.actionsTaken,
    conditionBefore: row.conditionBefore,
    conditionAfter: row.conditionAfter,
    outcome: row.outcome,
    labourCost: row.labourCost,
    materialsCost: row.materialsCost,
    otherCost: row.otherCost,
    nextRecommendedDate: row.nextRecommendedDate,
    notes: row.notes,
    photos,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

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

function timestampOrNull(value: string | null | undefined) {
  const trimmed = blankToNull(value);
  return trimmed ? new Date(trimmed) : null;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isTimestamp(value: string) {
  return z.iso.datetime().safeParse(value).success;
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
