import { asc, eq, inArray } from "drizzle-orm";
import type { AssetStorage } from "../storage/assets.js";
import {
  clients,
  locationPlanFeatures,
  locationPlans,
  locations,
  sites,
} from "./schema/index.js";
import type { PlanFeatureGeometry } from "./schema/locationPlans.js";
import type { Database } from "./types.js";

export type PlanFeatureInput = {
  locationId: string;
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
  labelOverride?: string | null;
  sortOrder?: number;
};

export async function loadPlanContextById(db: Database, planId: string) {
  const [row] = await db
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
    .where(eq(locationPlans.id, planId))
    .limit(1);

  return row ?? null;
}

export async function loadPlanContextByLocationId(db: Database, locationId: string) {
  const [row] = await db
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
    .where(eq(locationPlans.locationId, locationId))
    .limit(1);

  return row ?? null;
}

export type PlanContextRow = NonNullable<Awaited<ReturnType<typeof loadPlanContextById>>>;

export function presentPlanListItem(row: PlanContextRow) {
  return {
    id: row.id,
    name: row.name,
    contentType: row.contentType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    client: { id: row.clientId, name: row.clientName },
    site: { id: row.siteId, name: row.siteName },
    location: {
      id: row.locationId,
      name: row.locationName,
      locationCode: row.locationCode,
      locationType: row.locationType,
    },
  };
}

export async function presentPlanDetail(
  db: Database,
  storage: AssetStorage,
  row: NonNullable<Awaited<ReturnType<typeof loadPlanContextById>>>,
) {
  const featureRows = await db
    .select({
      id: locationPlanFeatures.id,
      locationId: locationPlanFeatures.locationId,
      geometry: locationPlanFeatures.geometry,
      labelOverride: locationPlanFeatures.labelOverride,
      sortOrder: locationPlanFeatures.sortOrder,
      locationCode: locations.locationCode,
      locationName: locations.name,
      locationType: locations.locationType,
    })
    .from(locationPlanFeatures)
    .innerJoin(locations, eq(locations.id, locationPlanFeatures.locationId))
    .where(eq(locationPlanFeatures.planId, row.id))
    .orderBy(asc(locationPlanFeatures.sortOrder), asc(locations.name));

  const url = await storage.planUrl(row.storageKey);

  return {
    ...presentPlanListItem(row),
    locationId: row.locationId,
    url,
    width: row.width,
    height: row.height,
    features: featureRows.map((feature) => ({
      id: feature.id,
      locationId: feature.locationId,
      location: {
        id: feature.locationId,
        locationCode: feature.locationCode,
        name: feature.locationName,
        locationType: feature.locationType,
      },
      geometry: feature.geometry,
      labelOverride: feature.labelOverride,
      sortOrder: feature.sortOrder,
    })),
  };
}

/** Slim plan shape used by legacy `/locations/:id/plan` responses. */
export async function presentLocationScopedPlan(
  db: Database,
  storage: AssetStorage,
  locationId: string,
) {
  const row = await loadPlanContextByLocationId(db, locationId);

  if (!row) {
    return null;
  }

  const detail = await presentPlanDetail(db, storage, row);

  return {
    id: detail.id,
    name: detail.name,
    locationId: detail.locationId,
    url: detail.url,
    contentType: detail.contentType,
    width: detail.width,
    height: detail.height,
    features: detail.features,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

export async function replacePlanFeatures(db: Database, planId: string, floorId: string, features: PlanFeatureInput[]) {
  const childIds = new Set(await descendantRoomAreaIds(db, floorId));

  for (const feature of features) {
    if (!childIds.has(feature.locationId)) {
      return {
        ok: false as const,
        error: `Feature location ${feature.locationId} must be a room or area under this floor.`,
      };
    }
  }

  await db.delete(locationPlanFeatures).where(eq(locationPlanFeatures.planId, planId));

  if (features.length > 0) {
    await db.insert(locationPlanFeatures).values(
      features.map((feature, index) => ({
        planId,
        locationId: feature.locationId,
        geometry: normalizeGeometry(feature.geometry),
        labelOverride:
          feature.labelOverride === undefined ? null : blankToNull(feature.labelOverride),
        sortOrder: feature.sortOrder ?? index,
      })),
    );
  }

  return { ok: true as const };
}

export async function descendantRoomAreaIds(db: Database, floorId: string) {
  const ids: string[] = [];
  let frontier = [floorId];

  while (frontier.length > 0) {
    const children = await db
      .select({
        id: locations.id,
        locationType: locations.locationType,
      })
      .from(locations)
      .where(inArray(locations.parentLocationId, frontier));

    frontier = [];

    for (const child of children) {
      if (child.locationType === "room" || child.locationType === "area") {
        ids.push(child.id);
      }

      if (child.locationType === "area" || child.locationType === "floor" || child.locationType === "building") {
        frontier.push(child.id);
      }
    }
  }

  return ids;
}

export function normalizeGeometry(geometry: {
  type: "Polygon";
  coordinates: number[][][];
}): PlanFeatureGeometry {
  return {
    type: "Polygon",
    coordinates: geometry.coordinates.map((ring) => ring.map((point) => [Number(point[0]), Number(point[1])])),
  };
}

export function planContentType(bytes: Uint8Array, declaredType: string) {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }

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

  const normalized = declaredType.split(";")[0]?.trim().toLowerCase() ?? "";

  if (
    normalized === "application/pdf" ||
    normalized === "image/jpeg" ||
    normalized === "image/png" ||
    normalized === "image/webp"
  ) {
    return normalized;
  }

  return null;
}

export function defaultPlanName(locationName: string | null, locationCode: string | null) {
  const fromName = locationName?.trim();
  if (fromName) {
    return fromName.slice(0, 255);
  }

  const fromCode = locationCode?.trim();
  if (fromCode) {
    return fromCode.slice(0, 255);
  }

  return "Floor plan";
}

function blankToNull(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
