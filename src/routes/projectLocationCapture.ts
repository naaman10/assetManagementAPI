import { and, asc, eq, type ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { clientIsVisible } from "../auth/clientAccess.js";
import { requireUser } from "../auth/middleware.js";
import {
  PROJECT_TYPE_FIELD_DEFINITIONS,
  catalogKey,
  sourcesForFocus,
  type ProjectTypeFieldSource,
  type ProjectTypeFieldType,
} from "../db/projectTypeFieldCatalog.js";
import type * as schema from "../db/schema/index.js";
import {
  LOCATION_STATUSES,
  LOCATION_TYPES,
  locations,
  PROJECT_LOCATION_REVIEW_STATUSES,
  projectLocationRecords,
  projectLocations,
  projectTypeFields,
  projectTypes,
  projects,
  sites,
} from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import type { AppEnv, AuthUser } from "../types.js";
import { readBody, routeError } from "./http.js";

const LOCATION_CAPTURE_SOURCES = new Set<ProjectTypeFieldSource>(sourcesForFocus("sites_locations"));

/** Location keys writable from capture save. siteId is display-only. */
const LOCATION_WRITABLE_KEYS = new Set([
  "locationCode",
  "name",
  "locationType",
  "description",
  "department",
  "uprn",
  "address",
  "latitude",
  "longitude",
  "status",
  "parentLocationId",
]);

type CaptureDb =
  | Database
  | PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

const catalogByKey = new Map(
  PROJECT_TYPE_FIELD_DEFINITIONS.map((definition) => [
    catalogKey(definition.source, definition.fieldKey),
    definition,
  ]),
);

const saveLocationCaptureSchema = z.object({
  location: z.record(z.string(), z.unknown()).optional(),
  site: z.record(z.string(), z.unknown()).optional(),
  reviewStatus: z.enum(PROJECT_LOCATION_REVIEW_STATUSES).optional(),
});

const patchLocationReviewSchema = z.object({
  reviewStatus: z.enum(PROJECT_LOCATION_REVIEW_STATUSES),
});

export const projectLocationCaptureRoutes = new Hono<AppEnv>();

projectLocationCaptureRoutes.get(
  "/projects/:projectId/locations/:locationId/capture",
  requireUser,
  async (c) => {
    const projectId = parseId(c.req.param("projectId"));
    const locationId = parseId(c.req.param("locationId"));

    if (!projectId || !locationId) {
      return c.json({ error: "Not found." }, 404);
    }

    const db = c.get("services").db;
    const user = c.get("user");
    const context = await loadCaptureContext(db, user, projectId, locationId);

    if (!context) {
      return c.json({ error: "Not found." }, 404);
    }

    if (context.projectTypeFocus === "assets") {
      return c.json(
        { error: "This project uses asset capture, not sites and locations capture." },
        400,
      );
    }

    const record = await ensureProjectLocationRecord(db, projectId, locationId, context.masterLocation);
    const capture = buildCaptureFromContext(context, record);

    return c.json({ capture });
  },
);

projectLocationCaptureRoutes.put(
  "/projects/:projectId/locations/:locationId/capture",
  requireUser,
  async (c) => {
    const projectId = parseId(c.req.param("projectId"));
    const locationId = parseId(c.req.param("locationId"));

    if (!projectId || !locationId) {
      return c.json({ error: "Not found." }, 404);
    }

    const parsed = saveLocationCaptureSchema.safeParse(await readBody(c));

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400);
    }

    const db = c.get("services").db;
    const user = c.get("user");
    const context = await loadCaptureContext(db, user, projectId, locationId);

    if (!context) {
      return c.json({ error: "Not found." }, 404);
    }

    if (context.projectTypeFocus === "assets") {
      return c.json(
        { error: "This project uses asset capture, not sites and locations capture." },
        400,
      );
    }

    const locationValues = parsed.data.location ?? {};
    const fieldsBySource = groupConfiguredFields(context.fields);
    const fieldErrors: string[] = [];

    for (const field of context.fields) {
      if (!field.required) {
        continue;
      }

      if (field.source === "site") {
        continue;
      }

      if (isEmptyValue(locationValues[field.key])) {
        fieldErrors.push(`${field.source}.${field.key} is required.`);
      }
    }

    if (fieldErrors.length > 0) {
      return c.json({ error: "Invalid request", details: { fields: fieldErrors } }, 400);
    }

    try {
      await db.transaction(async (tx) => {
        const existing = await ensureProjectLocationRecord(
          tx,
          projectId,
          locationId,
          context.masterLocation,
        );

        if (fieldsBySource.location.length > 0) {
          const locationPatch = await buildLocationPatch(
            tx,
            context,
            locationValues,
            fieldsBySource.location,
            locationId,
          );

          if (!locationPatch.ok) {
            throw new CaptureHttpError(locationPatch.error, locationPatch.status);
          }

          if (Object.keys(locationPatch.patch).length > 0) {
            await tx
              .update(projectLocationRecords)
              .set({ ...locationPatch.patch, updatedAt: new Date() })
              .where(eq(projectLocationRecords.id, existing.id));
          }
        }

        const reviewStatus = parsed.data.reviewStatus;
        if (reviewStatus) {
          await tx
            .update(projectLocations)
            .set({
              reviewStatus,
              updatedAt: new Date(),
            })
            .where(and(eq(projectLocations.projectId, projectId), eq(projectLocations.locationId, locationId)));
        } else if (context.reviewStatus === "todo") {
          await tx
            .update(projectLocations)
            .set({
              reviewStatus: "in_progress",
              updatedAt: new Date(),
            })
            .where(and(eq(projectLocations.projectId, projectId), eq(projectLocations.locationId, locationId)));
        }
      });
    } catch (error) {
      if (error instanceof CaptureHttpError) {
        return c.json({ error: error.message }, error.status);
      }

      return routeError(c, error);
    }

    const refreshed = await loadCaptureContext(db, user, projectId, locationId);

    if (!refreshed) {
      return c.json({ error: "Not found." }, 404);
    }

    const record = await ensureProjectLocationRecord(db, projectId, locationId, refreshed.masterLocation);
    const capture = buildCaptureFromContext(refreshed, record);

    return c.json({ capture });
  },
);

projectLocationCaptureRoutes.patch("/projects/:projectId/locations/:locationId", requireUser, async (c) => {
  const projectId = parseId(c.req.param("projectId"));
  const locationId = parseId(c.req.param("locationId"));

  if (!projectId || !locationId) {
    return c.json({ error: "Not found." }, 404);
  }

  const parsed = patchLocationReviewSchema.safeParse(await readBody(c));

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400);
  }

  const db = c.get("services").db;
  const user = c.get("user");
  const linked = await loadProjectLocationSummary(db, user, projectId, locationId);

  if (!linked) {
    return c.json({ error: "Not found." }, 404);
  }

  if (linked.projectTypeFocus === "assets") {
    return c.json({ error: "This project uses asset review, not sites and locations review." }, 400);
  }

  await db
    .update(projectLocations)
    .set({
      reviewStatus: parsed.data.reviewStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(projectLocations.projectId, projectId), eq(projectLocations.locationId, locationId)));

  const updated = await loadProjectLocationSummary(db, user, projectId, locationId);

  if (!updated) {
    return c.json({ error: "Not found." }, 404);
  }

  return c.json({
    location: {
      id: updated.id,
      siteId: updated.siteId,
      reviewStatus: updated.reviewStatus,
    },
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

type MasterLocation = {
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
};

type LocationRecord = MasterLocation & {
  id: string;
  projectId: string;
  locationId: string;
};

type SiteContext = {
  id: string;
  name: string;
  reference: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  county: string | null;
  postcode: string;
  country: string;
  contactId: string;
};

type CaptureContext = {
  projectId: string;
  projectTitle: string;
  projectReference: string;
  projectTypeId: string;
  projectTypeCode: string;
  projectTypeName: string;
  projectTypeFocus: string;
  clientId: string;
  locationId: string;
  reviewStatus: string;
  masterLocation: MasterLocation;
  site: SiteContext;
  fields: ConfiguredField[];
};

function buildCaptureFromContext(context: CaptureContext, record: LocationRecord) {
  const locationValues = locationValueMap(record);
  const siteValues = siteValueMap(context.site);

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
        focus: context.projectTypeFocus,
      },
    },
    location: {
      id: context.locationId,
      siteId: record.siteId,
      reviewStatus: context.reviewStatus,
      parentLocationId: record.parentLocationId,
      locationCode: record.locationCode,
      name: record.name,
      locationType: record.locationType,
      description: record.description,
      department: record.department,
      uprn: record.uprn,
      address: record.address,
      latitude: record.latitude,
      longitude: record.longitude,
      status: record.status,
    },
    site: {
      id: context.site.id,
      name: context.site.name,
      reference: context.site.reference,
      addressLine1: context.site.addressLine1,
      addressLine2: context.site.addressLine2,
      city: context.site.city,
      county: context.site.county,
      postcode: context.site.postcode,
      country: context.site.country,
      contactId: context.site.contactId,
    },
    fields: context.fields.map((field) => {
      let value: unknown = null;

      if (field.source === "location") {
        value = locationValues[field.key] ?? null;
      } else if (field.source === "site") {
        value = siteValues[field.key] ?? null;
      }

      return {
        source: field.source,
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        sortOrder: field.sortOrder,
        value,
      };
    }),
  };
}

async function loadCaptureContext(db: Database, user: AuthUser, projectId: string, locationId: string) {
  const [row] = await db
    .select({
      projectId: projects.id,
      projectTitle: projects.title,
      projectReference: projects.projectReference,
      projectTypeId: projects.projectTypeId,
      projectTypeCode: projectTypes.code,
      projectTypeName: projectTypes.name,
      projectTypeFocus: projectTypes.focus,
      clientId: projects.clientId,
      locationId: locations.id,
      reviewStatus: projectLocations.reviewStatus,
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
      locationClientId: sites.clientId,
      siteName: sites.name,
      siteReference: sites.reference,
      addressLine1: sites.addressLine1,
      addressLine2: sites.addressLine2,
      city: sites.city,
      county: sites.county,
      postcode: sites.postcode,
      country: sites.country,
      contactId: sites.contactId,
    })
    .from(projectLocations)
    .innerJoin(projects, eq(projectLocations.projectId, projects.id))
    .innerJoin(projectTypes, eq(projects.projectTypeId, projectTypes.id))
    .innerJoin(locations, eq(projectLocations.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(and(eq(projectLocations.projectId, projectId), eq(projectLocations.locationId, locationId)))
    .limit(1);

  if (!row || row.clientId !== row.locationClientId || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  const fieldRows = await db
    .select()
    .from(projectTypeFields)
    .where(eq(projectTypeFields.projectTypeId, row.projectTypeId))
    .orderBy(asc(projectTypeFields.sortOrder), asc(projectTypeFields.fieldKey));

  const fields: ConfiguredField[] = fieldRows
    .filter((fieldRow) => LOCATION_CAPTURE_SOURCES.has(fieldRow.source as ProjectTypeFieldSource))
    .map((fieldRow) => {
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
    projectTypeFocus: row.projectTypeFocus,
    clientId: row.clientId,
    locationId: row.locationId,
    reviewStatus: row.reviewStatus,
    masterLocation: {
      siteId: row.siteId,
      parentLocationId: row.parentLocationId,
      locationCode: row.locationCode,
      name: row.name,
      locationType: row.locationType,
      description: row.description,
      department: row.department,
      uprn: row.uprn,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      status: row.status,
    },
    site: {
      id: row.siteId,
      name: row.siteName,
      reference: row.siteReference,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      county: row.county,
      postcode: row.postcode,
      country: row.country,
      contactId: row.contactId,
    },
    fields,
  } satisfies CaptureContext;
}

async function ensureProjectLocationRecord(
  db: CaptureDb,
  projectId: string,
  locationId: string,
  master: MasterLocation,
) {
  const [existing] = await db
    .select()
    .from(projectLocationRecords)
    .where(and(eq(projectLocationRecords.projectId, projectId), eq(projectLocationRecords.locationId, locationId)))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(projectLocationRecords)
    .values({
      projectId,
      locationId,
      siteId: master.siteId,
      parentLocationId: master.parentLocationId,
      locationCode: master.locationCode,
      name: master.name,
      locationType: master.locationType,
      description: master.description,
      department: master.department,
      uprn: master.uprn,
      address: master.address,
      latitude: master.latitude,
      longitude: master.longitude,
      status: master.status,
    })
    .returning();

  if (!created) {
    throw new Error("Project location record was not created.");
  }

  return created;
}

async function loadProjectLocationSummary(db: Database, user: AuthUser, projectId: string, locationId: string) {
  const [row] = await db
    .select({
      id: locations.id,
      siteId: locations.siteId,
      reviewStatus: projectLocations.reviewStatus,
      projectTypeFocus: projectTypes.focus,
      clientId: projects.clientId,
      locationClientId: sites.clientId,
    })
    .from(projectLocations)
    .innerJoin(projects, eq(projectLocations.projectId, projects.id))
    .innerJoin(projectTypes, eq(projects.projectTypeId, projectTypes.id))
    .innerJoin(locations, eq(projectLocations.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(and(eq(projectLocations.projectId, projectId), eq(projectLocations.locationId, locationId)))
    .limit(1);

  if (!row || row.clientId !== row.locationClientId || !(await clientIsVisible(db, user, row.clientId))) {
    return null;
  }

  return {
    id: row.id,
    siteId: row.siteId,
    reviewStatus: row.reviewStatus,
    projectTypeFocus: row.projectTypeFocus,
  };
}

function groupConfiguredFields(fields: ConfiguredField[]) {
  return {
    site: fields.filter((field) => field.source === "site"),
    location: fields.filter((field) => field.source === "location"),
  };
}

function locationValueMap(record: MasterLocation): Record<string, unknown> {
  return {
    locationCode: record.locationCode,
    name: record.name,
    locationType: record.locationType,
    description: record.description,
    department: record.department,
    uprn: record.uprn,
    address: record.address,
    latitude: record.latitude,
    longitude: record.longitude,
    status: record.status,
    parentLocationId: record.parentLocationId,
    siteId: record.siteId,
  };
}

function siteValueMap(site: SiteContext): Record<string, unknown> {
  return {
    name: site.name,
    reference: site.reference,
    addressLine1: site.addressLine1,
    addressLine2: site.addressLine2,
    city: site.city,
    county: site.county,
    postcode: site.postcode,
    country: site.country,
    contactId: site.contactId,
  };
}

async function buildLocationPatch(
  db: CaptureDb,
  context: CaptureContext,
  values: Record<string, unknown>,
  configured: ConfiguredField[],
  locationId: string,
): Promise<{ ok: true; patch: Record<string, unknown> } | { ok: false; status: 400 | 404; error: string }> {
  const configuredKeys = new Set(configured.map((field) => field.key));
  const patch: Record<string, unknown> = {};

  for (const key of configuredKeys) {
    if (!LOCATION_WRITABLE_KEYS.has(key) || !(key in values)) {
      continue;
    }

    const raw = values[key];

    if (key === "locationCode") {
      if (raw == null || (typeof raw === "string" && raw.trim().length === 0)) {
        patch.locationCode = null;
        continue;
      }
      if (typeof raw !== "string" || raw.trim().length > 100) {
        return { ok: false, status: 400, error: "location.locationCode is invalid." };
      }
      patch.locationCode = raw.trim();
      continue;
    }

    if (key === "locationType") {
      if (raw == null || (typeof raw === "string" && raw.trim().length === 0)) {
        patch.locationType = null;
        continue;
      }
      if (typeof raw !== "string" || !LOCATION_TYPES.includes(raw as (typeof LOCATION_TYPES)[number])) {
        return { ok: false, status: 400, error: "location.locationType is invalid." };
      }
      patch.locationType = raw;
      continue;
    }

    if (key === "status") {
      if (typeof raw !== "string" || !LOCATION_STATUSES.includes(raw as (typeof LOCATION_STATUSES)[number])) {
        return { ok: false, status: 400, error: "location.status is invalid." };
      }
      patch.status = raw;
      continue;
    }

    if (key === "uprn") {
      if (raw == null || (typeof raw === "string" && raw.trim().length === 0)) {
        patch.uprn = null;
        continue;
      }
      if (typeof raw !== "string" || raw.trim().length > 12) {
        return { ok: false, status: 400, error: "location.uprn is invalid." };
      }
      patch.uprn = raw.trim();
      continue;
    }

    if (key === "latitude") {
      if (raw == null) {
        patch.latitude = null;
        continue;
      }
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < -90 || raw > 90) {
        return { ok: false, status: 400, error: "location.latitude is invalid." };
      }
      patch.latitude = raw;
      continue;
    }

    if (key === "longitude") {
      if (raw == null) {
        patch.longitude = null;
        continue;
      }
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < -180 || raw > 180) {
        return { ok: false, status: 400, error: "location.longitude is invalid." };
      }
      patch.longitude = raw;
      continue;
    }

    if (key === "parentLocationId") {
      if (raw == null || (typeof raw === "string" && raw.trim().length === 0)) {
        patch.parentLocationId = null;
        continue;
      }
      if (typeof raw !== "string" || !z.uuid().safeParse(raw).success) {
        return { ok: false, status: 400, error: "location.parentLocationId is invalid." };
      }
      if (raw === locationId) {
        return { ok: false, status: 400, error: "A location cannot be its own parent." };
      }
      const [parent] = await db
        .select({ id: locations.id, siteId: locations.siteId })
        .from(locations)
        .where(eq(locations.id, raw))
        .limit(1);
      if (!parent) {
        return { ok: false, status: 404, error: "Parent location not found." };
      }
      if (parent.siteId !== context.masterLocation.siteId) {
        return { ok: false, status: 400, error: "Parent location must belong to the same site." };
      }
      patch.parentLocationId = raw;
      continue;
    }

    if (typeof raw !== "string" && raw != null) {
      return { ok: false, status: 400, error: `location.${key} is invalid.` };
    }

    patch[key] = blankToNull(typeof raw === "string" ? raw : null);
  }

  return { ok: true, patch };
}

function isEmptyValue(value: unknown) {
  if (value == null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
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

function parseId(value: string) {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}
