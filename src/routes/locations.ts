import { and, asc, eq, isNull, SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { removeHistoryPhotos } from "../db/historyPhotoObjects.js";
import {
  defaultPlanName,
  planContentType,
  presentLocationScopedPlan,
  replacePlanFeatures,
} from "../db/locationPlanHelpers.js";
import {
  isClientOwnedPlanKey,
  isManagedLocationPlanKey,
  removeLocationPlans,
} from "../db/locationPlanObjects.js";
import {
  LOCATION_STATUSES,
  LOCATION_TYPES,
  clients,
  locationPlans,
  locations,
  sites,
} from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import { AssetStorageError } from "../storage/assets.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const MAX_PLAN_BYTES = 25 * 1024 * 1024;
const planNameField = z.string().trim().min(1).max(255);

const linkPlanSchema = z.object({
  storageKey: z.string().trim().min(1).max(512),
  contentType: z.string().trim().min(1).max(100),
  name: planNameField.optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
});

const planFeatureSchema = z.object({
  locationId: z.uuid(),
  geometry: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.array(z.number()).min(2).max(2)).min(3)).min(1),
  }),
  labelOverride: z.string().trim().max(255).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const replacePlanFeaturesSchema = z.object({
  features: z.array(planFeatureSchema),
});

const parentLocations = alias(locations, "parent_locations");

const locationCode = z.string().trim().max(100).nullable().optional();
const locationName = z.string().trim().max(255).nullable().optional();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalId = z.uuid().nullable().optional();
const locationType = z.enum(LOCATION_TYPES).nullable().optional();
const locationStatus = z.enum(LOCATION_STATUSES).optional();
const latitude = z
  .number()
  .finite()
  .gte(-90)
  .lte(90)
  .nullable()
  .optional();
const longitude = z
  .number()
  .finite()
  .gte(-180)
  .lte(180)
  .nullable()
  .optional();

const createLocationSchema = z.object({
  locationCode,
  name: locationName,
  parentLocationId: optionalId,
  locationType,
  description: optionalText(5000),
  department: optionalText(150),
  uprn: optionalText(12),
  address: optionalText(5000),
  latitude,
  longitude,
  status: locationStatus,
});

const updateLocationSchema = z
  .object({
    locationCode,
    name: locationName,
    parentLocationId: optionalId,
    locationType,
    description: optionalText(5000),
    department: optionalText(150),
    uprn: optionalText(12),
    address: optionalText(5000),
    latitude,
    longitude,
    status: locationStatus,
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "No changes were provided.",
  });

export const locationRoutes = new Hono<AppEnv>();

locationRoutes.get("/sites/:id/locations", requireUser, async (c) => {
  const siteId = parseId(c.req.param("id"));

  if (!siteId) {
    return c.json({ error: "Site not found." }, 404);
  }

  const db = c.get("services").db;
  const site = await visibleSite(db, c.get("user"), siteId);

  if (!site) {
    return c.json({ error: "Site not found." }, 404);
  }

  const filters = parseLocationListFilters(c.req.query("parentLocationId"), c.req.query("locationType"), c.req.query("status"));

  if ("error" in filters) {
    return c.json({ error: filters.error }, 400);
  }

  const rows = await locationsForSite(db, siteId, filters);
  return c.json({ locationCount: rows.length, locations: rows });
});

locationRoutes.post("/sites/:id/locations", requireUser, async (c) => {
  const siteId = parseId(c.req.param("id"));

  if (!siteId) {
    return c.json({ error: "Site not found." }, 404);
  }

  const parsed = createLocationSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const site = await visibleSite(db, c.get("user"), siteId);

  if (!site) {
    return c.json({ error: "Site not found." }, 404);
  }

  const parentLocationId = parsed.data.parentLocationId ?? null;
  const parent = await resolveParentLocation(db, parentLocationId, {
    locationId: null,
    siteId,
    locationType: parsed.data.locationType ?? null,
  });

  if ("error" in parent) {
    return c.json({ error: parent.error }, parent.status);
  }

  try {
    const [created] = await db
      .insert(locations)
      .values({
        siteId,
        parentLocationId: parent.parentLocationId,
        locationCode: blankToNull(parsed.data.locationCode),
        name: blankToNull(parsed.data.name),
        locationType: parsed.data.locationType ?? null,
        description: blankToNull(parsed.data.description),
        department: blankToNull(parsed.data.department),
        uprn: blankToNull(parsed.data.uprn),
        address: blankToNull(parsed.data.address),
        latitude: parsed.data.latitude ?? null,
        longitude: parsed.data.longitude ?? null,
        status: parsed.data.status ?? "active",
      })
      .returning();

    if (!created) {
      throw new Error("Location was not created.");
    }

    const location = await loadLocation(db, c.get("user"), created.id);

    if (!location) {
      throw new Error("Location was not created.");
    }

    return c.json({ location }, 201);
  } catch (error) {
    return locationWriteError(c, error);
  }
});

locationRoutes.get("/locations/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Location not found." }, 404);
  }

  const location = await loadLocation(c.get("services").db, c.get("user"), id);

  if (!location) {
    return c.json({ error: "Location not found." }, 404);
  }

  return c.json({ location });
});

locationRoutes.get("/locations/:id/plan", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Location not found." }, 404);
  }

  const db = c.get("services").db;
  const location = await loadLocation(db, c.get("user"), id);

  if (!location) {
    return c.json({ error: "Location not found." }, 404);
  }

  const plan = await presentLocationScopedPlan(db, c.get("services").assets, id);

  if (!plan) {
    return c.json({ error: "Plan not found." }, 404);
  }

  return c.json({ plan });
});

/** Upload a new plan (multipart field `plan`) or link an existing object (`{ storageKey, contentType }`). Floors only. */
locationRoutes.put("/locations/:id/plan", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Location not found." }, 404);
  }

  const db = c.get("services").db;
  const location = await loadLocation(db, c.get("user"), id);

  if (!location) {
    return c.json({ error: "Location not found." }, 404);
  }

  if (location.locationType !== "floor") {
    return c.json({ error: "Plans can only be attached to floor locations." }, 400);
  }

  const contentTypeHeader = c.req.header("content-type") ?? "";
  const storage = c.get("services").assets;
  let storageKey: string;
  let contentType: string;
  let width: number | null = null;
  let height: number | null = null;
  let name: string | undefined;

  if (contentTypeHeader.includes("multipart/form-data")) {
    const body = await c.req.parseBody({ all: true });
    const file = body.plan;
    const nameRaw = typeof body.name === "string" ? body.name : undefined;

    if (nameRaw !== undefined) {
      const nameParsed = planNameField.safeParse(nameRaw);

      if (!nameParsed.success) {
        return c.json({ error: "Name must be 1–255 characters." }, 400);
      }

      name = nameParsed.data;
    }

    if (!(file instanceof File)) {
      return c.json({ error: "A plan file is required (field name: plan)." }, 400);
    }

    if (file.size > MAX_PLAN_BYTES) {
      return c.json({ error: "Plan file must be 25 MB or less." }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = planContentType(bytes, file.type);

    if (!detected) {
      return c.json({ error: "Plan must be a PDF, JPEG, PNG, or WebP file." }, 400);
    }

    contentType = detected;
    const planId = crypto.randomUUID();

    try {
      storageKey = await storage.putLocationPlan(location.client.id, id, planId, bytes, contentType);
    } catch (error) {
      if (error instanceof AssetStorageError) {
        return c.json({ error: error.message }, 503);
      }
      return routeError(c, error);
    }
  } else {
    const parsed = linkPlanSchema.safeParse(await readBody(c));

    if (!parsed.success) {
      return invalidRequest(c, parsed.error);
    }

    if (!isClientOwnedPlanKey(location.client.id, parsed.data.storageKey)) {
      return c.json({ error: "storageKey must belong to this client." }, 400);
    }

    storageKey = parsed.data.storageKey;
    contentType = parsed.data.contentType;
    width = parsed.data.width ?? null;
    height = parsed.data.height ?? null;
    name = parsed.data.name;
  }

  const [existing] = await db
    .select({
      id: locationPlans.id,
      storageKey: locationPlans.storageKey,
      name: locationPlans.name,
    })
    .from(locationPlans)
    .where(eq(locationPlans.locationId, id))
    .limit(1);

  const previousKey = existing?.storageKey ?? null;
  const resolvedName =
    name ??
    existing?.name ??
    defaultPlanName(location.name, location.locationCode);

  try {
    if (existing) {
      await db
        .update(locationPlans)
        .set({
          name: resolvedName,
          storageKey,
          contentType,
          width,
          height,
          updatedAt: new Date(),
        })
        .where(eq(locationPlans.id, existing.id));
    } else {
      await db.insert(locationPlans).values({
        locationId: id,
        name: resolvedName,
        storageKey,
        contentType,
        width,
        height,
      });
    }
  } catch (error) {
    if (isManagedLocationPlanKey(storageKey) && storageKey !== previousKey) {
      try {
        await storage.deleteObject(storageKey);
      } catch (cleanupError) {
        console.error("Failed to remove location plan after a failed save", cleanupError);
      }
    }
    return routeError(c, error);
  }

  if (previousKey && previousKey !== storageKey && isManagedLocationPlanKey(previousKey)) {
    try {
      await storage.deleteObject(previousKey);
    } catch (error) {
      console.error("Failed to remove previous location plan object", error);
    }
  }

  const plan = await presentLocationScopedPlan(db, storage, id);

  if (!plan) {
    throw new Error("Location plan was not saved.");
  }

  return c.json({ plan });
});

locationRoutes.put("/locations/:id/plan/features", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Location not found." }, 404);
  }

  const parsed = replacePlanFeaturesSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const location = await loadLocation(db, c.get("user"), id);

  if (!location) {
    return c.json({ error: "Location not found." }, 404);
  }

  const [plan] = await db.select({ id: locationPlans.id }).from(locationPlans).where(eq(locationPlans.locationId, id)).limit(1);

  if (!plan) {
    return c.json({ error: "Plan not found." }, 404);
  }

  const replaced = await replacePlanFeatures(db, plan.id, id, parsed.data.features);

  if (!replaced.ok) {
    return c.json({ error: replaced.error }, 400);
  }

  const presented = await presentLocationScopedPlan(db, c.get("services").assets, id);

  if (!presented) {
    throw new Error("Location plan was not found after updating features.");
  }

  return c.json({ plan: presented });
});

locationRoutes.delete("/locations/:id/plan", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Location not found." }, 404);
  }

  const db = c.get("services").db;
  const location = await loadLocation(db, c.get("user"), id);

  if (!location) {
    return c.json({ error: "Location not found." }, 404);
  }

  const [plan] = await db
    .select({ id: locationPlans.id, storageKey: locationPlans.storageKey })
    .from(locationPlans)
    .where(eq(locationPlans.locationId, id))
    .limit(1);

  if (!plan) {
    return c.json({ error: "Plan not found." }, 404);
  }

  await db.delete(locationPlans).where(eq(locationPlans.id, plan.id));

  if (isManagedLocationPlanKey(plan.storageKey)) {
    try {
      await c.get("services").assets.deleteObject(plan.storageKey);
    } catch (error) {
      console.error("Failed to remove location plan object", error);
    }
  }

  return c.json({ ok: true });
});

locationRoutes.patch("/locations/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Location not found." }, 404);
  }

  const parsed = updateLocationSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const current = await loadLocation(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Location not found." }, 404);
  }

  const parentLocationId =
    parsed.data.parentLocationId === undefined ? current.parentLocationId : parsed.data.parentLocationId;
  const nextType = parsed.data.locationType === undefined ? current.locationType : parsed.data.locationType;
  const parent = await resolveParentLocation(db, parentLocationId, {
    locationId: id,
    siteId: current.siteId,
    locationType: nextType,
  });

  if ("error" in parent) {
    return c.json({ error: parent.error }, parent.status);
  }

  try {
    await db
      .update(locations)
      .set({
        parentLocationId: parent.parentLocationId,
        locationCode: parsed.data.locationCode === undefined ? current.locationCode : blankToNull(parsed.data.locationCode),
        name: parsed.data.name === undefined ? current.name : blankToNull(parsed.data.name),
        locationType: parsed.data.locationType === undefined ? current.locationType : parsed.data.locationType,
        description: parsed.data.description === undefined ? current.description : blankToNull(parsed.data.description),
        department: parsed.data.department === undefined ? current.department : blankToNull(parsed.data.department),
        uprn: parsed.data.uprn === undefined ? current.uprn : blankToNull(parsed.data.uprn),
        address: parsed.data.address === undefined ? current.address : blankToNull(parsed.data.address),
        latitude: parsed.data.latitude === undefined ? current.latitude : parsed.data.latitude,
        longitude: parsed.data.longitude === undefined ? current.longitude : parsed.data.longitude,
        status: parsed.data.status ?? current.status,
        updatedAt: new Date(),
      })
      .where(eq(locations.id, id));

    return c.json({ location: await loadLocation(db, c.get("user"), id) });
  } catch (error) {
    return locationWriteError(c, error);
  }
});

locationRoutes.delete("/locations/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Location not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadLocation(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Location not found." }, 404);
  }

  const storage = c.get("services").assets;
  await removeLocationPlans(db, storage, { locationId: id });

  try {
    await db.delete(locations).where(eq(locations.id, id));
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return c.json({ error: "Location still has child locations or assets." }, 409);
    }

    return routeError(c, error);
  }

  await removeHistoryPhotos(db, storage, { locationId: id });
  return c.json({ ok: true });
});

export async function locationsForSite(
  db: Database,
  siteId: string,
  filters: LocationListFilters = {},
) {
  const conditions: SQL[] = [eq(locations.siteId, siteId)];

  if (filters.parentLocationId === null) {
    conditions.push(isNull(locations.parentLocationId));
  } else if (filters.parentLocationId) {
    conditions.push(eq(locations.parentLocationId, filters.parentLocationId));
  }

  if (filters.locationType) {
    conditions.push(eq(locations.locationType, filters.locationType));
  }

  if (filters.status) {
    conditions.push(eq(locations.status, filters.status));
  }

  const rows = await db
    .select({
      id: locations.id,
      siteId: locations.siteId,
      parentLocationId: locations.parentLocationId,
      locationCode: locations.locationCode,
      name: locations.name,
      locationType: locations.locationType,
      description: locations.description,
      department: locations.department,
      uprn: locations.uprn,
      address: locations.address,
      latitude: locations.latitude,
      longitude: locations.longitude,
      status: locations.status,
      createdAt: locations.createdAt,
      updatedAt: locations.updatedAt,
      parentLocationCode: parentLocations.locationCode,
      parentLocationName: parentLocations.name,
      parentLocationType: parentLocations.locationType,
    })
    .from(locations)
    .leftJoin(parentLocations, eq(locations.parentLocationId, parentLocations.id))
    .where(and(...conditions))
    .orderBy(asc(locations.name), asc(locations.locationCode));

  return rows.map((row) => presentLocation(row));
}

async function visibleSite(db: Database, user: Parameters<typeof clientIsVisible>[1], siteId: string) {
  const [site] = await db.select({ id: sites.id, clientId: sites.clientId }).from(sites).where(eq(sites.id, siteId)).limit(1);

  if (!site || !(await clientIsVisible(db, user, site.clientId))) {
    return null;
  }

  return site;
}

async function loadLocation(db: Database, user: AuthUser, id: string) {
  const [row] = await db
    .select({
      id: locations.id,
      siteId: locations.siteId,
      parentLocationId: locations.parentLocationId,
      locationCode: locations.locationCode,
      name: locations.name,
      locationType: locations.locationType,
      description: locations.description,
      department: locations.department,
      uprn: locations.uprn,
      address: locations.address,
      latitude: locations.latitude,
      longitude: locations.longitude,
      status: locations.status,
      createdAt: locations.createdAt,
      updatedAt: locations.updatedAt,
      parentLocationCode: parentLocations.locationCode,
      parentLocationName: parentLocations.name,
      parentLocationType: parentLocations.locationType,
      clientId: clients.id,
      clientName: clients.name,
    })
    .from(locations)
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .leftJoin(parentLocations, eq(locations.parentLocationId, parentLocations.id))
    .where(eq(locations.id, id))
    .limit(1);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  return {
    ...presentLocation(row),
    client: {
      id: row.clientId,
      name: row.clientName,
    },
  };
}

async function resolveParentLocation(
  db: Database,
  parentLocationId: string | null,
  context: { locationId: string | null; siteId: string; locationType: string | null },
) {
  if (!parentLocationId) {
    if (context.locationType === "floor" || context.locationType === "room") {
      return {
        status: 400 as const,
        error:
          context.locationType === "floor"
            ? "A floor parent must be a building."
            : "A room parent must be a floor or building.",
      };
    }

    return { parentLocationId: null };
  }

  if (context.locationId && parentLocationId === context.locationId) {
    return { status: 400 as const, error: "A location cannot be its own parent." };
  }

  if (context.locationType == null) {
    return { status: 400 as const, error: "A location without a type cannot have a parent." };
  }

  const [parent] = await db
    .select({
      id: locations.id,
      siteId: locations.siteId,
      locationType: locations.locationType,
    })
    .from(locations)
    .where(eq(locations.id, parentLocationId))
    .limit(1);

  if (!parent) {
    return { status: 404 as const, error: "Parent location not found." };
  }

  if (parent.siteId !== context.siteId) {
    return { status: 400 as const, error: "Parent location must belong to the same site." };
  }

  if (parent.locationType === "room") {
    return { status: 400 as const, error: "A room cannot contain child locations." };
  }

  if (!parentTypeAllowed(context.locationType, parent.locationType)) {
    return { status: 400 as const, error: parentTypeError(context.locationType) };
  }

  if (context.locationId) {
    const cycle = await parentWouldCycle(db, context.locationId, parentLocationId);

    if (cycle) {
      return { status: 400 as const, error: "Parent location would create a cycle." };
    }
  }

  return { parentLocationId };
}

function parentTypeAllowed(childType: string, parentType: string | null) {
  if (childType === "building") {
    return false;
  }

  if (childType === "floor") {
    return parentType === "building";
  }

  if (childType === "room") {
    return parentType === "floor" || parentType === "building";
  }

  if (childType === "area") {
    return parentType === "building" || parentType === "floor" || parentType === "area";
  }

  return false;
}

function parentTypeError(childType: string) {
  if (childType === "building") {
    return "A building must be a root location under the site.";
  }

  if (childType === "floor") {
    return "A floor parent must be a building.";
  }

  if (childType === "room") {
    return "A room parent must be a floor or building.";
  }

  return "An area parent must be a building, floor, area, or the site root.";
}

async function parentWouldCycle(db: Database, locationId: string, parentLocationId: string) {
  let current: string | null = parentLocationId;
  const seen = new Set<string>();

  while (current) {
    if (current === locationId || seen.has(current)) {
      return true;
    }

    seen.add(current);

    const [row] = await db
      .select({ parentLocationId: locations.parentLocationId })
      .from(locations)
      .where(eq(locations.id, current))
      .limit(1);

    current = row?.parentLocationId ?? null;
  }

  return false;
}

function presentLocation(location: {
  id: string;
  siteId: string;
  parentLocationId: string | null;
  locationCode: string | null;
  name: string | null;
  locationType: string | null;
  description: string | null;
  department: string | null;
  uprn: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  parentLocationCode?: string | null;
  parentLocationName?: string | null;
  parentLocationType?: string | null;
}) {
  return {
    id: location.id,
    siteId: location.siteId,
    parentLocationId: location.parentLocationId,
    parentLocation: parentLocationSummary(
      location.parentLocationId,
      location.parentLocationCode ?? null,
      location.parentLocationName ?? null,
      location.parentLocationType ?? null,
    ),
    locationCode: location.locationCode,
    name: location.name,
    locationType: location.locationType,
    description: location.description,
    department: location.department,
    uprn: location.uprn,
    address: location.address,
    latitude: location.latitude,
    longitude: location.longitude,
    status: location.status,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
  };
}

function parentLocationSummary(
  id: string | null,
  locationCode: string | null,
  name: string | null,
  locationType: string | null,
) {
  if (!id) {
    return null;
  }

  return { id, locationCode, name, locationType };
}

type LocationListFilters = {
  parentLocationId?: string | null;
  locationType?: (typeof LOCATION_TYPES)[number];
  status?: (typeof LOCATION_STATUSES)[number];
};

function parseLocationListFilters(
  parentLocationIdRaw: string | undefined,
  locationTypeRaw: string | undefined,
  statusRaw: string | undefined,
): LocationListFilters | { error: string } {
  const filters: LocationListFilters = {};

  if (parentLocationIdRaw !== undefined) {
    if (parentLocationIdRaw === "" || parentLocationIdRaw === "null" || parentLocationIdRaw === "root") {
      filters.parentLocationId = null;
    } else {
      const parentLocationId = parseId(parentLocationIdRaw);

      if (!parentLocationId) {
        return { error: "parentLocationId must be a UUID, root, or null." };
      }

      filters.parentLocationId = parentLocationId;
    }
  }

  if (locationTypeRaw !== undefined && locationTypeRaw !== "") {
    const parsed = z.enum(LOCATION_TYPES).safeParse(locationTypeRaw);

    if (!parsed.success) {
      return { error: "locationType must be building, floor, room, or area." };
    }

    filters.locationType = parsed.data;
  }

  if (statusRaw !== undefined && statusRaw !== "") {
    const parsed = z.enum(LOCATION_STATUSES).safeParse(statusRaw);

    if (!parsed.success) {
      return { error: "status must be active, inactive, or demolished." };
    }

    filters.status = parsed.data;
  }

  return filters;
}

function locationWriteError(c: Parameters<typeof routeError>[0], error: unknown) {
  if (isCheckViolation(error)) {
    return c.json({ error: checkViolationMessage(error) }, 400);
  }

  return routeError(c, error);
}

function checkViolationMessage(error: unknown) {
  const message = errorMessage(error);

  if (message.includes("cycle")) {
    return "Parent location would create a cycle.";
  }

  if (message.includes("room cannot contain")) {
    return "A room cannot contain child locations.";
  }

  if (message.includes("without a type")) {
    return "A location without a type cannot have a parent.";
  }

  if (message.includes("building must be a root")) {
    return "A building must be a root location under the site.";
  }

  if (message.includes("floor parent")) {
    return "A floor parent must be a building.";
  }

  if (message.includes("room parent")) {
    return "A room parent must be a floor or building.";
  }

  if (message.includes("area parent")) {
    return "An area parent must be a building, floor, area, or the site root.";
  }

  if (message.includes("invalidate child")) {
    return "Location type change would invalidate child locations.";
  }

  return "Invalid location hierarchy.";
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  if ("message" in error && typeof error.message === "string") {
    return error.message;
  }

  if ("cause" in error) {
    return errorMessage(error.cause);
  }

  return "";
}

function isForeignKeyViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("code" in error && error.code === "23503") {
    return true;
  }

  if ("cause" in error) {
    return isForeignKeyViolation(error.cause);
  }

  return false;
}

function isCheckViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("code" in error && error.code === "23514") {
    return true;
  }

  if ("cause" in error) {
    return isCheckViolation(error.cause);
  }

  return false;
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

