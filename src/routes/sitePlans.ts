import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible, clientVisibility } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import {
  loadPlanContextById,
  planContentType,
  presentPlanDetail,
  presentPlanListItem,
  replacePlanFeatures,
  type PlanFeatureInput,
} from "../db/locationPlanHelpers.js";
import { isManagedLocationPlanKey } from "../db/locationPlanObjects.js";
import { clients, locationPlans, locations, sites } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import { AssetStorageError } from "../storage/assets.js";
import type { AppEnv, AuthUser } from "../types.js";
import { invalidRequest, readBody, routeError } from "./http.js";

const MAX_PLAN_BYTES = 25 * 1024 * 1024;

const planName = z.string().trim().min(1).max(255);

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

const patchPlanJsonSchema = z
  .object({
    name: planName.optional(),
  })
  .refine((value) => value.name !== undefined, {
    message: "No changes were provided.",
  });

export const sitePlanRoutes = new Hono<AppEnv>();

sitePlanRoutes.get("/site-plans", requireUser, async (c) => {
  const db = c.get("services").db;
  const visibility = clientVisibility(db, c.get("user"));

  const rows = await db
    .select({
      id: locationPlans.id,
      name: locationPlans.name,
      locationId: locationPlans.locationId,
      storageKey: locationPlans.storageKey,
      contentType: locationPlans.contentType,
      width: locationPlans.width,
      height: locationPlans.height,
      createdAt: locationPlans.createdAt,
      updatedAt: locationPlans.updatedAt,
      locationCode: locations.locationCode,
      locationName: locations.name,
      locationType: locations.locationType,
      siteId: sites.id,
      siteName: sites.name,
      clientId: clients.id,
      clientName: clients.name,
    })
    .from(locationPlans)
    .innerJoin(locations, eq(locations.id, locationPlans.locationId))
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(visibility)
    .orderBy(asc(locationPlans.name), asc(locationPlans.createdAt));

  const sitePlans = rows.map((row) => presentPlanListItem(row));
  return c.json({ sitePlanCount: sitePlans.length, sitePlans });
});

sitePlanRoutes.get("/site-plans/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Site plan not found." }, 404);
  }

  const db = c.get("services").db;
  const row = await loadVisiblePlan(db, c.get("user"), id);

  if (!row) {
    return c.json({ error: "Site plan not found." }, 404);
  }

  const sitePlan = await presentPlanDetail(db, c.get("services").assets, row);
  return c.json({ sitePlan });
});

sitePlanRoutes.post("/site-plans", requireUser, async (c) => {
  const contentTypeHeader = c.req.header("content-type") ?? "";

  if (!contentTypeHeader.includes("multipart/form-data")) {
    return c.json({ error: "Multipart form data is required." }, 400);
  }

  const body = await c.req.parseBody({ all: true });
  const locationIdRaw = typeof body.locationId === "string" ? body.locationId : "";
  const nameRaw = typeof body.name === "string" ? body.name : "";
  const file = body.plan;

  const locationId = parseId(locationIdRaw);
  const nameParsed = planName.safeParse(nameRaw);

  if (!locationId) {
    return c.json({ error: "A valid locationId is required." }, 400);
  }

  if (!nameParsed.success) {
    return c.json({ error: "A name is required (1–255 characters)." }, 400);
  }

  if (!(file instanceof File)) {
    return c.json({ error: "A plan file is required (field name: plan)." }, 400);
  }

  if (file.size > MAX_PLAN_BYTES) {
    return c.json({ error: "Plan file must be 25 MB or less." }, 400);
  }

  const db = c.get("services").db;
  const floor = await loadVisibleFloor(db, c.get("user"), locationId);

  if (!floor) {
    return c.json({ error: "Location not found." }, 404);
  }

  if (floor.locationType !== "floor") {
    return c.json({ error: "Plans can only be attached to floor locations." }, 400);
  }

  const [existing] = await db
    .select({ id: locationPlans.id })
    .from(locationPlans)
    .where(eq(locationPlans.locationId, locationId))
    .limit(1);

  if (existing) {
    return c.json({ error: "This floor already has a site plan." }, 409);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = planContentType(bytes, file.type);

  if (!contentType) {
    return c.json({ error: "Plan must be a PDF, JPEG, PNG, or WebP file." }, 400);
  }

  const planId = crypto.randomUUID();
  const storage = c.get("services").assets;
  let storageKey: string;

  try {
    storageKey = await storage.putLocationPlan(floor.clientId, locationId, planId, bytes, contentType);
  } catch (error) {
    if (error instanceof AssetStorageError) {
      return c.json({ error: error.message }, 503);
    }
    return routeError(c, error);
  }

  try {
    await db.insert(locationPlans).values({
      id: planId,
      locationId,
      name: nameParsed.data,
      storageKey,
      contentType,
    });
  } catch (error) {
    if (isManagedLocationPlanKey(storageKey)) {
      try {
        await storage.deleteObject(storageKey);
      } catch (cleanupError) {
        console.error("Failed to remove site plan after a failed create", cleanupError);
      }
    }

    if (isUniqueViolation(error)) {
      return c.json({ error: "This floor already has a site plan." }, 409);
    }

    return routeError(c, error);
  }

  const row = await loadPlanContextById(db, planId);

  if (!row) {
    throw new Error("Site plan was not created.");
  }

  const sitePlan = await presentPlanDetail(db, storage, row);
  return c.json({ sitePlan }, 201);
});

sitePlanRoutes.patch("/site-plans/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Site plan not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadVisiblePlan(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Site plan not found." }, 404);
  }

  const contentTypeHeader = c.req.header("content-type") ?? "";
  const storage = c.get("services").assets;
  let nextName = current.name;
  let nextStorageKey = current.storageKey;
  let nextContentType = current.contentType;
  let nextWidth = current.width;
  let nextHeight = current.height;
  let uploadedKey: string | null = null;

  if (contentTypeHeader.includes("multipart/form-data")) {
    const body = await c.req.parseBody({ all: true });
    const nameRaw = typeof body.name === "string" ? body.name : undefined;
    const file = body.plan;

    if (nameRaw !== undefined) {
      const nameParsed = planName.safeParse(nameRaw);

      if (!nameParsed.success) {
        return c.json({ error: "Name must be 1–255 characters." }, 400);
      }

      nextName = nameParsed.data;
    }

    if (file instanceof File) {
      if (file.size > MAX_PLAN_BYTES) {
        return c.json({ error: "Plan file must be 25 MB or less." }, 400);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const detected = planContentType(bytes, file.type);

      if (!detected) {
        return c.json({ error: "Plan must be a PDF, JPEG, PNG, or WebP file." }, 400);
      }

      try {
        uploadedKey = await storage.putLocationPlan(
          current.clientId,
          current.locationId,
          crypto.randomUUID(),
          bytes,
          detected,
        );
      } catch (error) {
        if (error instanceof AssetStorageError) {
          return c.json({ error: error.message }, 503);
        }
        return routeError(c, error);
      }

      nextStorageKey = uploadedKey;
      nextContentType = detected;
      nextWidth = null;
      nextHeight = null;
    } else if (nameRaw === undefined) {
      return c.json({ error: "Provide a name and/or plan file to update." }, 400);
    }
  } else {
    const parsed = patchPlanJsonSchema.safeParse(await readBody(c));

    if (!parsed.success) {
      return invalidRequest(c, parsed.error);
    }

    if (parsed.data.name !== undefined) {
      nextName = parsed.data.name;
    }
  }

  const previousKey = current.storageKey;

  try {
    await db
      .update(locationPlans)
      .set({
        name: nextName,
        storageKey: nextStorageKey,
        contentType: nextContentType,
        width: nextWidth,
        height: nextHeight,
        updatedAt: new Date(),
      })
      .where(eq(locationPlans.id, id));
  } catch (error) {
    if (uploadedKey && isManagedLocationPlanKey(uploadedKey)) {
      try {
        await storage.deleteObject(uploadedKey);
      } catch (cleanupError) {
        console.error("Failed to remove site plan after a failed update", cleanupError);
      }
    }
    return routeError(c, error);
  }

  if (
    previousKey !== nextStorageKey &&
    isManagedLocationPlanKey(previousKey)
  ) {
    try {
      await storage.deleteObject(previousKey);
    } catch (error) {
      console.error("Failed to remove previous site plan object", error);
    }
  }

  const row = await loadPlanContextById(db, id);

  if (!row) {
    throw new Error("Site plan was not updated.");
  }

  const sitePlan = await presentPlanDetail(db, storage, row);
  return c.json({ sitePlan });
});

sitePlanRoutes.put("/site-plans/:id/features", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Site plan not found." }, 404);
  }

  const parsed = replacePlanFeaturesSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return invalidRequest(c, parsed.error);
  }

  const db = c.get("services").db;
  const current = await loadVisiblePlan(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Site plan not found." }, 404);
  }

  const features: PlanFeatureInput[] = parsed.data.features;
  const replaced = await replacePlanFeatures(db, id, current.locationId, features);

  if (!replaced.ok) {
    return c.json({ error: replaced.error }, 400);
  }

  const row = await loadPlanContextById(db, id);

  if (!row) {
    throw new Error("Site plan was not found after updating features.");
  }

  const sitePlan = await presentPlanDetail(db, c.get("services").assets, row);
  return c.json({ sitePlan });
});

sitePlanRoutes.delete("/site-plans/:id", requireUser, async (c) => {
  const id = parseId(c.req.param("id"));

  if (!id) {
    return c.json({ error: "Site plan not found." }, 404);
  }

  const db = c.get("services").db;
  const current = await loadVisiblePlan(db, c.get("user"), id);

  if (!current) {
    return c.json({ error: "Site plan not found." }, 404);
  }

  await db.delete(locationPlans).where(eq(locationPlans.id, id));

  if (isManagedLocationPlanKey(current.storageKey)) {
    try {
      await c.get("services").assets.deleteObject(current.storageKey);
    } catch (error) {
      console.error("Failed to remove site plan object", error);
    }
  }

  return c.json({ ok: true });
});

async function loadVisiblePlan(db: Database, user: AuthUser, planId: string) {
  const row = await loadPlanContextById(db, planId);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  return row;
}

async function loadVisibleFloor(db: Database, user: AuthUser, locationId: string) {
  const [row] = await db
    .select({
      id: locations.id,
      locationType: locations.locationType,
      name: locations.name,
      locationCode: locations.locationCode,
      clientId: clients.id,
    })
    .from(locations)
    .innerJoin(sites, eq(sites.id, locations.siteId))
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(eq(locations.id, locationId))
    .limit(1);

  if (!row || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  return row;
}

function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
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
