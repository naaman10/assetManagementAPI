import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { ASSET_STATUSES, assetTypes, assets, locations, sites } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody } from "./http.js";

const assetRef = z.string().trim().min(1).max(100);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const years = z.number().int().min(0).max(2_147_483_647).nullable().optional();
const quantity = z
  .number()
  .finite()
  .gte(-9_999_999_999.99)
  .lte(9_999_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: "Use at most 2 decimal places.",
  })
  .nullable()
  .optional();
const installationDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((value) => value == null || value.length === 0 || isCalendarDate(value), {
    message: "Enter a date as YYYY-MM-DD.",
  });

const createAssetSchema = z.object({
  assetTypeId: z.uuid(),
  assetRef,
  assetName: optionalText(5000),
  description: optionalText(5000),
  quantity,
  unitOfMeasure: optionalText(30),
  installationDate,
  estimatedAgeYears: years,
  expectedLifeYears: years,
  status: z.enum(ASSET_STATUSES).optional(),
});

const updateAssetSchema = z
  .object({
    assetTypeId: z.uuid().optional(),
    assetRef: assetRef.optional(),
    assetName: optionalText(5000),
    description: optionalText(5000),
    quantity,
    unitOfMeasure: optionalText(30),
    installationDate,
    estimatedAgeYears: years,
    expectedLifeYears: years,
    status: z.enum(ASSET_STATUSES).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const assetRoutes = new Hono<AppEnv>();

assetRoutes.get("/locations/:id/assets", requireUser, async (c) => {
  const locationId = parseId(c.req.param("id"));

  if (!locationId) {
    return c.json({ error: "Location not found." }, 404);
  }

  const db = c.get("services").db;
  const location = await visibleLocation(db, c.get("user"), locationId);

  if (!location) {
    return c.json({ error: "Location not found." }, 404);
  }

  const rows = await assetsForLocation(db, locationId);
  return c.json({ assetCount: rows.length, assets: rows });
});

assetRoutes.post("/locations/:id/assets", requireUser, async (c) => {
  const locationId = parseId(c.req.param("id"));

  if (!locationId) {
    return c.json({ error: "Location not found." }, 404);
  }

  const parsed = createAssetSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const location = await visibleLocation(db, c.get("user"), locationId);

  if (!location) {
    return c.json({ error: "Location not found." }, 404);
  }

  if (!(await assetTypeExists(db, parsed.data.assetTypeId))) {
    return c.json({ error: "Asset type not found." }, 404);
  }

  const [created] = await db
    .insert(assets)
    .values({
      locationId,
      assetTypeId: parsed.data.assetTypeId,
      assetRef: parsed.data.assetRef,
      assetName: blankToNull(parsed.data.assetName),
      description: blankToNull(parsed.data.description),
      quantity: parsed.data.quantity ?? null,
      unitOfMeasure: blankToNull(parsed.data.unitOfMeasure),
      installationDate: blankToNull(parsed.data.installationDate),
      estimatedAgeYears: parsed.data.estimatedAgeYears ?? null,
      expectedLifeYears: parsed.data.expectedLifeYears ?? null,
      status: parsed.data.status ?? "active",
    })
    .returning();

  if (!created) {
    throw new Error("Asset was not created.");
  }

  return c.json({ asset: presentAsset(created) }, 201);
});

assetRoutes.get("/assets/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const asset = await loadAsset(c.get("services").db, c.get("user"), id);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  return c.json({ asset });
});

assetRoutes.patch("/assets/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const parsed = updateAssetSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const current = await loadAsset(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Asset not found." }, 404);
  }

  if (parsed.data.assetTypeId && !(await assetTypeExists(db, parsed.data.assetTypeId))) {
    return c.json({ error: "Asset type not found." }, 404);
  }

  await db
    .update(assets)
    .set({
      assetTypeId: parsed.data.assetTypeId ?? current.assetTypeId,
      assetRef: parsed.data.assetRef ?? current.assetRef,
      assetName: parsed.data.assetName === undefined ? current.assetName : blankToNull(parsed.data.assetName),
      description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
      quantity: parsed.data.quantity === undefined ? current.quantity : parsed.data.quantity,
      unitOfMeasure: parsed.data.unitOfMeasure === undefined ? current.unitOfMeasure : blankToNull(parsed.data.unitOfMeasure),
      installationDate:
        parsed.data.installationDate === undefined ? current.installationDate : blankToNull(parsed.data.installationDate),
      estimatedAgeYears: parsed.data.estimatedAgeYears === undefined ? current.estimatedAgeYears : parsed.data.estimatedAgeYears,
      expectedLifeYears: parsed.data.expectedLifeYears === undefined ? current.expectedLifeYears : parsed.data.expectedLifeYears,
      status: parsed.data.status ?? current.status,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, id));

  return c.json({ asset: await loadAsset(db, c.get("user"), id) });
});

assetRoutes.delete("/assets/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadAsset(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Asset not found." }, 404);
  }

  await db.delete(assets).where(eq(assets.id, id));
  return c.json({ ok: true });
});

async function assetsForLocation(db: Database, locationId: string) {
  const rows = await db
    .select()
    .from(assets)
    .where(eq(assets.locationId, locationId))
    .orderBy(asc(assets.assetRef), asc(assets.assetName));

  return rows.map((row) => presentAsset(row));
}

async function visibleLocation(db: Database, user: AuthUser, locationId: string) {
  const [location] = await db
    .select({ id: locations.id, clientId: sites.clientId })
    .from(locations)
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .where(eq(locations.id, locationId))
    .limit(1);

  if (!location || !(await clientIsVisible(db, user, location.clientId))) {
    return null;
  }

  return location;
}

async function loadAsset(db: Database, user: AuthUser, id: string) {
  const [row] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);

  if (!row) {
    return null;
  }

  const location = await visibleLocation(db, user, row.locationId);

  if (!location) {
    return null;
  }

  return presentAsset(row);
}

async function assetTypeExists(db: Database, id: string) {
  const [row] = await db.select({ id: assetTypes.id }).from(assetTypes).where(eq(assetTypes.id, id)).limit(1);
  return Boolean(row);
}

function presentAsset(asset: typeof assets.$inferSelect) {
  return {
    id: asset.id,
    locationId: asset.locationId,
    assetTypeId: asset.assetTypeId,
    assetRef: asset.assetRef,
    assetName: asset.assetName,
    description: asset.description,
    quantity: asset.quantity,
    unitOfMeasure: asset.unitOfMeasure,
    installationDate: asset.installationDate,
    estimatedAgeYears: asset.estimatedAgeYears,
    expectedLifeYears: asset.expectedLifeYears,
    status: asset.status,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
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

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
