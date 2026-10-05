import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import { locations, sites } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv } from "../types.js";
import { invalidRequest, readBody } from "./http.js";

const locationCode = z.string().trim().max(100).nullable().optional();
const locationName = z.string().trim().max(255).nullable().optional();

const createLocationSchema = z.object({
  locationCode,
  name: locationName,
});

const updateLocationSchema = z
  .object({
    locationCode,
    name: locationName,
  })
  .refine((value) => value.locationCode !== undefined || value.name !== undefined, {
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

  const rows = await locationsForSite(db, siteId);
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

  const [created] = await db
    .insert(locations)
    .values({
      siteId,
      locationCode: blankToNull(parsed.data.locationCode),
      name: blankToNull(parsed.data.name),
    })
    .returning();

  if (!created) {
    throw new Error("Location was not created.");
  }

  return c.json({ location: presentLocation(created) }, 201);
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

  await db
    .update(locations)
    .set({
      locationCode: parsed.data.locationCode === undefined ? current.locationCode : blankToNull(parsed.data.locationCode),
      name: parsed.data.name === undefined ? current.name : blankToNull(parsed.data.name),
      updatedAt: new Date(),
    })
    .where(eq(locations.id, id));

  return c.json({ location: await loadLocation(db, c.get("user"), id) });
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

  await db.delete(locations).where(eq(locations.id, id));
  return c.json({ ok: true });
});

export async function locationsForSite(db: Database, siteId: string) {
  const rows = await db
    .select()
    .from(locations)
    .where(eq(locations.siteId, siteId))
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

async function loadLocation(db: Database, user: Parameters<typeof clientIsVisible>[1], id: string) {
  const [row] = await db.select().from(locations).where(eq(locations.id, id)).limit(1);

  if (!row) {
    return null;
  }

  const site = await visibleSite(db, user, row.siteId);

  if (!site) {
    return null;
  }

  return presentLocation(row);
}

function presentLocation(location: typeof locations.$inferSelect) {
  return {
    id: location.id,
    siteId: location.siteId,
    locationCode: location.locationCode,
    name: location.name,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
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
