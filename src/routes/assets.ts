import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { deleteUnconductedSurveys } from "../db/deleteUnconductedSurveys.js";
import { removeHistoryPhotos } from "../db/historyPhotoObjects.js";
import {
  ASSET_STATUSES,
  assetTypes,
  assets,
  clients,
  locations,
  nrm3Classifications,
  projectAssets,
  projectTypes,
  projects,
  sites,
} from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const parentAssets = alias(assets, "parent_assets");

const tag = z.string().trim().min(1).max(100);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const years = z.number().int().min(0).max(2_147_483_647).nullable().optional();
const yearOfManufacture = z.number().int().min(1000).max(9999).nullable().optional();
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

const optionalId = z.uuid().nullable().optional();
const optionalNrm3Code = z.string().trim().min(1).max(100).nullable().optional();
const attachProjectSchema = z.object({
  projectId: z.uuid(),
});

const createAssetSchema = z.object({
  assetTypeId: z.uuid(),
  tag,
  assetName: optionalText(5000),
  description: optionalText(5000),
  manufacturer: optionalText(5000),
  model: optionalText(150),
  serialNumber: optionalText(150),
  yearOfManufacture,
  quantity,
  unitOfMeasure: optionalText(30),
  installationDate,
  estimatedAgeYears: years,
  expectedLifeYears: years,
  status: z.enum(ASSET_STATUSES).optional(),
  nrm3Code: optionalNrm3Code,
  parentAssetId: optionalId,
});

const updateAssetSchema = z
  .object({
    assetTypeId: z.uuid().optional(),
    tag: tag.optional(),
    assetName: optionalText(5000),
    description: optionalText(5000),
    manufacturer: optionalText(5000),
    model: optionalText(150),
    serialNumber: optionalText(150),
    yearOfManufacture,
    quantity,
    unitOfMeasure: optionalText(30),
    installationDate,
    estimatedAgeYears: years,
    expectedLifeYears: years,
    status: z.enum(ASSET_STATUSES).optional(),
    nrm3Code: optionalNrm3Code,
    parentAssetId: optionalId,
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const assetRoutes = new Hono<AppEnv>();

assetRoutes.get("/sites/:id/assets", requireUser, async (c) => {
  const siteId = parseId(c.req.param("id"));

  if (!siteId) {
    return c.json({ error: "Site not found." }, 404);
  }

  const db = c.get("services").db;
  const site = await visibleSite(db, c.get("user"), siteId);

  if (!site) {
    return c.json({ error: "Site not found." }, 404);
  }

  const rows = await assetsForSite(db, siteId);
  return c.json({ assetCount: rows.length, assets: rows });
});

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

  const nrm3 = await resolveNrm3Code(db, parsed.data.nrm3Code ?? null);

  if ("error" in nrm3) {
    return c.json({ error: nrm3.error }, nrm3.status);
  }

  const parentAssetId = parsed.data.parentAssetId ?? null;
  const parent = await resolveParentAsset(db, c.get("user"), parentAssetId, {
    assetId: null,
    clientId: location.clientId,
  });

  if ("error" in parent) {
    return c.json({ error: parent.error }, parent.status);
  }

  const [created] = await db
    .insert(assets)
    .values({
      locationId,
      assetTypeId: parsed.data.assetTypeId,
      nrm3Code: nrm3.nrm3Code,
      parentAssetId: parent.parentAssetId,
      tag: parsed.data.tag,
      assetName: blankToNull(parsed.data.assetName),
      description: blankToNull(parsed.data.description),
      manufacturer: blankToNull(parsed.data.manufacturer),
      model: blankToNull(parsed.data.model),
      serialNumber: blankToNull(parsed.data.serialNumber),
      yearOfManufacture: parsed.data.yearOfManufacture ?? null,
      quantity: parsed.data.quantity ?? null,
      unitOfMeasure: blankToNull(parsed.data.unitOfMeasure),
      installationDate: blankToNull(parsed.data.installationDate),
      estimatedAgeYears: parsed.data.estimatedAgeYears ?? null,
      expectedLifeYears: parsed.data.expectedLifeYears ?? null,
      status: parsed.data.status ?? "active",
    })
    .returning({ id: assets.id });

  if (!created) {
    throw new Error("Asset was not created.");
  }

  const asset = await loadAsset(db, c.get("user"), created.id);

  if (!asset) {
    throw new Error("Asset was not created.");
  }

  return c.json({ asset }, 201);
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

assetRoutes.post("/assets/:id/projects", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const parsed = attachProjectSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const asset = await loadAsset(db, c.get("user"), id);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const project = await visibleProjectOnClient(db, c.get("user"), parsed.data.projectId, asset.client.id);

  if (!project) {
    return c.json({ error: "Project not found." }, 404);
  }

  try {
    await db.insert(projectAssets).values({ projectId: project.id, assetId: id }).onConflictDoNothing();
  } catch (error) {
    return routeError(c, error);
  }

  return c.json({ asset: await loadAsset(db, c.get("user"), id) }, 201);
});

assetRoutes.delete("/assets/:id/projects/:projectId", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));
  const projectId = parseId(c.req.param("projectId"));

  if (!id) {
    return c.json({ error: "Asset not found." }, 404);
  }

  if (!projectId) {
    return c.json({ error: "Project not found." }, 404);
  }

  const db = c.get("services").db;
  const asset = await loadAsset(db, c.get("user"), id);

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const project = await visibleProjectOnClient(db, c.get("user"), projectId, asset.client.id);

  if (!project) {
    return c.json({ error: "Project not found." }, 404);
  }

  const deleted = await db
    .delete(projectAssets)
    .where(and(eq(projectAssets.assetId, id), eq(projectAssets.projectId, projectId)))
    .returning({ projectId: projectAssets.projectId });

  if (deleted.length === 0) {
    return c.json({ error: "Asset is not on that project." }, 404);
  }

  await deleteUnconductedSurveys(db, [{ projectId, assetId: id }]);

  return c.json({ ok: true });
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

  const nrm3Code =
    parsed.data.nrm3Code === undefined ? current.nrm3Code : parsed.data.nrm3Code;
  const nrm3 = await resolveNrm3Code(db, nrm3Code);

  if ("error" in nrm3) {
    return c.json({ error: nrm3.error }, nrm3.status);
  }

  const parentAssetId =
    parsed.data.parentAssetId === undefined ? current.parentAssetId : parsed.data.parentAssetId;
  const parent = await resolveParentAsset(db, c.get("user"), parentAssetId, {
    assetId: id,
    clientId: current.client.id,
  });

  if ("error" in parent) {
    return c.json({ error: parent.error }, parent.status);
  }

  await db
    .update(assets)
    .set({
      assetTypeId: parsed.data.assetTypeId ?? current.assetTypeId,
      nrm3Code: nrm3.nrm3Code,
      parentAssetId: parent.parentAssetId,
      tag: parsed.data.tag ?? current.tag,
      assetName: parsed.data.assetName === undefined ? current.assetName : blankToNull(parsed.data.assetName),
      description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
      manufacturer: parsed.data.manufacturer === undefined ? current.manufacturer : blankToNull(parsed.data.manufacturer),
      model: parsed.data.model === undefined ? current.model : blankToNull(parsed.data.model),
      serialNumber: parsed.data.serialNumber === undefined ? current.serialNumber : blankToNull(parsed.data.serialNumber),
      yearOfManufacture:
        parsed.data.yearOfManufacture === undefined ? current.yearOfManufacture : parsed.data.yearOfManufacture,
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

  try {
    await removeHistoryPhotos(db, c.get("services").assets, { assetId: id });
    await db.delete(assets).where(eq(assets.id, id));
  } catch (error) {
    return routeError(c, error);
  }

  return c.json({ ok: true });
});

const assetListColumns = {
  id: assets.id,
  locationId: assets.locationId,
  assetTypeId: assets.assetTypeId,
  tag: assets.tag,
  assetName: assets.assetName,
  description: assets.description,
  manufacturer: assets.manufacturer,
  model: assets.model,
  serialNumber: assets.serialNumber,
  yearOfManufacture: assets.yearOfManufacture,
  quantity: assets.quantity,
  unitOfMeasure: assets.unitOfMeasure,
  installationDate: assets.installationDate,
  estimatedAgeYears: assets.estimatedAgeYears,
  expectedLifeYears: assets.expectedLifeYears,
  status: assets.status,
  createdAt: assets.createdAt,
  updatedAt: assets.updatedAt,
  nrm3Code: assets.nrm3Code,
  parentAssetId: assets.parentAssetId,
  siteId: locations.siteId,
  locationCode: locations.locationCode,
  locationName: locations.name,
  clientId: clients.id,
  clientName: clients.name,
  assetTypeCode: assetTypes.code,
  assetTypeName: assetTypes.name,
  nrm3Name: nrm3Classifications.name,
  nrm3Level: nrm3Classifications.level,
  parentAssetTag: parentAssets.tag,
  parentAssetName: parentAssets.assetName,
};

function assetListQuery(db: Database) {
  return db
    .select(assetListColumns)
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .innerJoin(assetTypes, eq(assets.assetTypeId, assetTypes.id))
    .leftJoin(nrm3Classifications, eq(assets.nrm3Code, nrm3Classifications.code))
    .leftJoin(parentAssets, eq(assets.parentAssetId, parentAssets.id));
}

async function assetsForLocation(db: Database, locationId: string) {
  const rows = await assetListQuery(db)
    .where(eq(assets.locationId, locationId))
    .orderBy(asc(assets.tag), asc(assets.assetName));

  return presentAssets(db, rows);
}

async function assetsForSite(db: Database, siteId: string) {
  const rows = await assetListQuery(db)
    .where(eq(locations.siteId, siteId))
    .orderBy(asc(locations.name), asc(locations.locationCode), asc(assets.tag), asc(assets.assetName));

  return presentAssets(db, rows);
}

async function visibleSite(db: Database, user: AuthUser, siteId: string) {
  const [site] = await db.select({ id: sites.id, clientId: sites.clientId }).from(sites).where(eq(sites.id, siteId)).limit(1);

  if (!site || !(await clientIsVisible(db, user, site.clientId))) {
    return null;
  }

  return site;
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
  const [row] = await assetListQuery(db).where(eq(assets.id, id)).limit(1);

  if (!row) {
    return null;
  }

  const location = await visibleLocation(db, user, row.locationId);

  if (!location) {
    return null;
  }

  const [asset] = await presentAssets(db, [row]);
  return asset ?? null;
}

async function presentAssets(db: Database, rows: AssetRow[]) {
  const projectsByAsset = await projectsForAssets(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => presentAsset(row, projectsByAsset.get(row.id) ?? []));
}

async function projectsForAssets(db: Database, assetIds: string[]) {
  const projectsByAsset = new Map<string, AssetProject[]>();

  if (assetIds.length === 0) {
    return projectsByAsset;
  }

  const links = await db
    .select({
      assetId: projectAssets.assetId,
      id: projects.id,
      title: projects.title,
      projectReference: projects.projectReference,
      status: projects.status,
      projectTypeId: projects.projectTypeId,
      projectTypeCode: projectTypes.code,
      projectTypeName: projectTypes.name,
    })
    .from(projectAssets)
    .innerJoin(projects, eq(projectAssets.projectId, projects.id))
    .innerJoin(projectTypes, eq(projects.projectTypeId, projectTypes.id))
    .where(inArray(projectAssets.assetId, assetIds))
    .orderBy(sql`${projects.dueDate} ASC NULLS LAST`, asc(projects.title));

  for (const link of links) {
    const list = projectsByAsset.get(link.assetId) ?? [];
    list.push({
      id: link.id,
      title: link.title,
      projectReference: link.projectReference,
      status: link.status,
      projectType: {
        id: link.projectTypeId,
        code: link.projectTypeCode,
        name: link.projectTypeName,
      },
    });
    projectsByAsset.set(link.assetId, list);
  }

  return projectsByAsset;
}

async function visibleProjectOnClient(db: Database, user: AuthUser, projectId: string, clientId: string) {
  const [project] = await db
    .select({ id: projects.id, clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project || project.clientId !== clientId || !(await clientIsVisible(db, user, project.clientId))) {
    return null;
  }

  return project;
}

async function assetTypeExists(db: Database, id: string) {
  const [row] = await db.select({ id: assetTypes.id }).from(assetTypes).where(eq(assetTypes.id, id)).limit(1);
  return Boolean(row);
}

async function resolveParentAsset(
  db: Database,
  user: AuthUser,
  parentAssetId: string | null,
  context: { assetId: string | null; clientId: string },
) {
  if (!parentAssetId) {
    return { parentAssetId: null };
  }

  if (context.assetId && parentAssetId === context.assetId) {
    return { status: 400 as const, error: "An asset cannot be its own parent." };
  }

  const [parent] = await db
    .select({
      id: assets.id,
      clientId: sites.clientId,
    })
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .where(eq(assets.id, parentAssetId))
    .limit(1);

  if (!parent || !(await clientIsVisible(db, user, parent.clientId))) {
    return { status: 404 as const, error: "Parent asset not found." };
  }

  if (parent.clientId !== context.clientId) {
    return { status: 400 as const, error: "Parent asset must belong to the same client." };
  }

  if (context.assetId) {
    const cycle = await parentWouldCycle(db, context.assetId, parentAssetId);

    if (cycle) {
      return { status: 400 as const, error: "Parent asset would create a cycle." };
    }
  }

  return { parentAssetId };
}

async function parentWouldCycle(db: Database, assetId: string, parentAssetId: string) {
  let current: string | null = parentAssetId;
  const seen = new Set<string>();

  while (current) {
    if (current === assetId) {
      return true;
    }

    if (seen.has(current)) {
      return true;
    }

    seen.add(current);

    const [row] = await db
      .select({ parentAssetId: assets.parentAssetId })
      .from(assets)
      .where(eq(assets.id, current))
      .limit(1);

    current = row?.parentAssetId ?? null;
  }

  return false;
}

async function resolveNrm3Code(db: Database, nrm3Code: string | null) {
  if (!nrm3Code) {
    return { nrm3Code: null };
  }

  const [nrm3] = await db
    .select({ code: nrm3Classifications.code })
    .from(nrm3Classifications)
    .where(eq(nrm3Classifications.code, nrm3Code))
    .limit(1);

  if (!nrm3) {
    return { status: 404 as const, error: "NRM3 classification not found." };
  }

  return { nrm3Code };
}

type AssetRow = {
  id: string;
  locationId: string;
  assetTypeId: string;
  tag: string;
  assetName: string | null;
  description: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  yearOfManufacture: number | null;
  quantity: number | null;
  unitOfMeasure: string | null;
  installationDate: string | null;
  estimatedAgeYears: number | null;
  expectedLifeYears: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  siteId: string;
  locationCode: string | null;
  locationName: string | null;
  clientId: string;
  clientName: string;
  assetTypeCode: string;
  assetTypeName: string;
  nrm3Code: string | null;
  parentAssetId: string | null;
  nrm3Name: string | null;
  nrm3Level: number | null;
  parentAssetTag: string | null;
  parentAssetName: string | null;
};

type AssetProject = {
  id: string;
  title: string;
  projectReference: string;
  status: string;
  projectType: { id: string; code: string; name: string };
};

function presentAsset(asset: AssetRow, assetProjects: AssetProject[]) {
  return {
    id: asset.id,
    client: {
      id: asset.clientId,
      name: asset.clientName,
    },
    locationId: asset.locationId,
    location: {
      id: asset.locationId,
      siteId: asset.siteId,
      locationCode: asset.locationCode,
      name: asset.locationName,
    },
    assetTypeId: asset.assetTypeId,
    assetType: {
      id: asset.assetTypeId,
      code: asset.assetTypeCode,
      name: asset.assetTypeName,
    },
    nrm3Code: asset.nrm3Code,
    nrm3Classification: nrm3Ref(asset.nrm3Code, asset.nrm3Name, asset.nrm3Level),
    parentAssetId: asset.parentAssetId,
    parentAsset: parentAssetSummary(asset.parentAssetId, asset.parentAssetTag, asset.parentAssetName),
    tag: asset.tag,
    assetName: asset.assetName,
    description: asset.description,
    manufacturer: asset.manufacturer,
    model: asset.model,
    serialNumber: asset.serialNumber,
    yearOfManufacture: asset.yearOfManufacture,
    quantity: asset.quantity,
    unitOfMeasure: asset.unitOfMeasure,
    installationDate: asset.installationDate,
    estimatedAgeYears: asset.estimatedAgeYears,
    expectedLifeYears: asset.expectedLifeYears,
    status: asset.status,
    projects: assetProjects,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function nrm3Ref(code: string | null, name: string | null, level: number | null) {
  if (!code || !name || level == null) {
    return null;
  }

  return { code, name, level };
}

function parentAssetSummary(id: string | null, tagValue: string | null, assetName: string | null) {
  if (!id || !tagValue) {
    return null;
  }

  return { id, tag: tagValue, assetName };
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
