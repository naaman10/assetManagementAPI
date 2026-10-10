import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { removeHistoryPhotos } from "../db/historyPhotoObjects.js";
import { ASSET_STATUSES, assetTypes, assets, bcisRefs, bcisSubRefs, clients, elements, groups, locations, sites, subElements } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

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

const optionalId = z.uuid().nullable().optional();

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
  groupId: optionalId,
  elementId: optionalId,
  subElementId: optionalId,
  bcisRefId: optionalId,
  bcisSubRefId: optionalId,
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
    groupId: optionalId,
    elementId: optionalId,
    subElementId: optionalId,
    bcisRefId: optionalId,
    bcisSubRefId: optionalId,
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

  const classification = await classificationForAsset(db, parsed.data);

  if ("error" in classification) {
    return c.json({ error: classification.error }, classification.status);
  }

  const [created] = await db
    .insert(assets)
    .values({
      locationId,
      assetTypeId: parsed.data.assetTypeId,
      ...classification,
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

  const classification = await classificationForAsset(db, parsed.data, current);

  if ("error" in classification) {
    return c.json({ error: classification.error }, classification.status);
  }

  await db
    .update(assets)
    .set({
      assetTypeId: parsed.data.assetTypeId ?? current.assetTypeId,
      ...classification,
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
  assetRef: assets.assetRef,
  assetName: assets.assetName,
  description: assets.description,
  quantity: assets.quantity,
  unitOfMeasure: assets.unitOfMeasure,
  installationDate: assets.installationDate,
  estimatedAgeYears: assets.estimatedAgeYears,
  expectedLifeYears: assets.expectedLifeYears,
  status: assets.status,
  createdAt: assets.createdAt,
  updatedAt: assets.updatedAt,
  groupId: assets.groupId,
  elementId: assets.elementId,
  subElementId: assets.subElementId,
  bcisRefId: assets.bcisRefId,
  bcisSubRefId: assets.bcisSubRefId,
  siteId: locations.siteId,
  locationCode: locations.locationCode,
  locationName: locations.name,
  clientId: clients.id,
  clientName: clients.name,
  assetTypeCode: assetTypes.code,
  assetTypeName: assetTypes.name,
  groupCode: groups.code,
  groupName: groups.name,
  elementCode: elements.code,
  elementName: elements.name,
  subElementCode: subElements.code,
  subElementName: subElements.name,
  bcisRefCode: bcisRefs.code,
  bcisRefName: bcisRefs.name,
  bcisSubRefCode: bcisSubRefs.code,
  bcisSubRefName: bcisSubRefs.name,
};

function assetListQuery(db: Database) {
  return db
    .select(assetListColumns)
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .innerJoin(assetTypes, eq(assets.assetTypeId, assetTypes.id))
    .leftJoin(groups, eq(assets.groupId, groups.id))
    .leftJoin(elements, eq(assets.elementId, elements.id))
    .leftJoin(subElements, eq(assets.subElementId, subElements.id))
    .leftJoin(bcisRefs, eq(assets.bcisRefId, bcisRefs.id))
    .leftJoin(bcisSubRefs, eq(assets.bcisSubRefId, bcisSubRefs.id));
}

async function assetsForLocation(db: Database, locationId: string) {
  const rows = await assetListQuery(db)
    .where(eq(assets.locationId, locationId))
    .orderBy(asc(assets.assetRef), asc(assets.assetName));

  return rows.map((row) => presentAsset(row));
}

async function assetsForSite(db: Database, siteId: string) {
  const rows = await assetListQuery(db)
    .where(eq(locations.siteId, siteId))
    .orderBy(asc(locations.name), asc(locations.locationCode), asc(assets.assetRef), asc(assets.assetName));

  return rows.map((row) => presentAsset(row));
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

  return presentAsset(row);
}

async function assetTypeExists(db: Database, id: string) {
  const [row] = await db.select({ id: assetTypes.id }).from(assetTypes).where(eq(assetTypes.id, id)).limit(1);
  return Boolean(row);
}

async function classificationForAsset(
  db: Database,
  input: {
    groupId?: string | null;
    elementId?: string | null;
    subElementId?: string | null;
    bcisRefId?: string | null;
    bcisSubRefId?: string | null;
  },
  current?: {
    groupId: string | null;
    elementId: string | null;
    subElementId: string | null;
    bcisRefId: string | null;
    bcisSubRefId: string | null;
  },
) {
  const groupId = chosenId(input.groupId, current?.groupId);
  const elementId = chosenId(input.elementId, current?.elementId);
  const subElementId = chosenId(input.subElementId, current?.subElementId);
  const bcisRefId = chosenId(input.bcisRefId, current?.bcisRefId);
  const bcisSubRefId = chosenId(input.bcisSubRefId, current?.bcisSubRefId);

  if (groupId) {
    const [group] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).limit(1);

    if (!group) {
      return { status: 404 as const, error: "Group not found." };
    }
  }

  if (elementId) {
    const [element] = await db.select({ groupId: elements.groupId }).from(elements).where(eq(elements.id, elementId)).limit(1);

    if (!element) {
      return { status: 404 as const, error: "Element not found." };
    }

    if (!groupId) {
      return { status: 400 as const, error: "Choose a group for this element." };
    }

    if (element.groupId !== groupId) {
      return { status: 400 as const, error: "Element does not belong to that group." };
    }
  }

  if (subElementId) {
    const [subElement] = await db
      .select({ elementId: subElements.elementId })
      .from(subElements)
      .where(eq(subElements.id, subElementId))
      .limit(1);

    if (!subElement) {
      return { status: 404 as const, error: "Sub element not found." };
    }

    if (!elementId) {
      return { status: 400 as const, error: "Choose an element for this sub element." };
    }

    if (subElement.elementId !== elementId) {
      return { status: 400 as const, error: "Sub element does not belong to that element." };
    }
  }

  if (bcisRefId) {
    const [bcisRef] = await db.select({ id: bcisRefs.id }).from(bcisRefs).where(eq(bcisRefs.id, bcisRefId)).limit(1);

    if (!bcisRef) {
      return { status: 404 as const, error: "BCIS reference not found." };
    }
  }

  if (bcisSubRefId) {
    const [bcisSubRef] = await db
      .select({ bcisRefId: bcisSubRefs.bcisRefId })
      .from(bcisSubRefs)
      .where(eq(bcisSubRefs.id, bcisSubRefId))
      .limit(1);

    if (!bcisSubRef) {
      return { status: 404 as const, error: "BCIS sub reference not found." };
    }

    if (!bcisRefId) {
      return { status: 400 as const, error: "Choose a BCIS reference for this BCIS sub reference." };
    }

    if (bcisSubRef.bcisRefId !== bcisRefId) {
      return { status: 400 as const, error: "BCIS sub reference does not belong to that BCIS reference." };
    }
  }

  return { groupId, elementId, subElementId, bcisRefId, bcisSubRefId };
}

function chosenId(next: string | null | undefined, previous: string | null | undefined) {
  return next === undefined ? (previous ?? null) : next;
}

function presentAsset(asset: {
  id: string;
  locationId: string;
  assetTypeId: string;
  assetRef: string;
  assetName: string | null;
  description: string | null;
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
  groupId: string | null;
  elementId: string | null;
  subElementId: string | null;
  bcisRefId: string | null;
  bcisSubRefId: string | null;
  groupCode: string | null;
  groupName: string | null;
  elementCode: string | null;
  elementName: string | null;
  subElementCode: string | null;
  subElementName: string | null;
  bcisRefCode: string | null;
  bcisRefName: string | null;
  bcisSubRefCode: string | null;
  bcisSubRefName: string | null;
}) {
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
    groupId: asset.groupId,
    group: catalogRef(asset.groupId, asset.groupCode, asset.groupName),
    elementId: asset.elementId,
    element: catalogRef(asset.elementId, asset.elementCode, asset.elementName),
    subElementId: asset.subElementId,
    subElement: catalogRef(asset.subElementId, asset.subElementCode, asset.subElementName),
    bcisRefId: asset.bcisRefId,
    bcisRef: catalogRef(asset.bcisRefId, asset.bcisRefCode, asset.bcisRefName),
    bcisSubRefId: asset.bcisSubRefId,
    bcisSubRef: catalogRef(asset.bcisSubRefId, asset.bcisSubRefCode, asset.bcisSubRefName),
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

function catalogRef(id: string | null, code: string | null, name: string | null) {
  if (!id || !code || !name) {
    return null;
  }

  return { id, code, name };
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
