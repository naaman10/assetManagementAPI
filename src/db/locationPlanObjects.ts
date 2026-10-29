import { eq, inArray } from "drizzle-orm";
import type { AssetStorage } from "../storage/assets.js";
import { locationPlans, locations, sites } from "./schema/index.js";
import type { Database } from "./types.js";

type PlanScope = { locationId: string } | { siteId: string } | { clientId: string };

/** Delete plan objects from storage for the given scope. DB rows cascade with locations. */
export async function removeLocationPlans(db: Database, storage: AssetStorage, scope: PlanScope) {
  const keys = await planStorageKeys(db, scope);

  for (const key of keys) {
    // Keep manually uploaded fixture keys under site-plans/; only remove API-managed uploads.
    if (!isManagedLocationPlanKey(key)) {
      continue;
    }

    try {
      await storage.deleteObject(key);
    } catch (error) {
      console.error("Failed to remove location plan object", key, error);
    }
  }
}

async function planStorageKeys(db: Database, scope: PlanScope) {
  if ("locationId" in scope) {
    const rows = await db
      .select({ storageKey: locationPlans.storageKey })
      .from(locationPlans)
      .where(eq(locationPlans.locationId, scope.locationId));
    return rows.map((row) => row.storageKey);
  }

  if ("siteId" in scope) {
    const rows = await db
      .select({ storageKey: locationPlans.storageKey })
      .from(locationPlans)
      .innerJoin(locations, eq(locations.id, locationPlans.locationId))
      .where(eq(locations.siteId, scope.siteId));
    return rows.map((row) => row.storageKey);
  }

  const siteRows = await db.select({ id: sites.id }).from(sites).where(eq(sites.clientId, scope.clientId));
  const siteIds = siteRows.map((row) => row.id);

  if (siteIds.length === 0) {
    return [];
  }

  const locationRows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(inArray(locations.siteId, siteIds));
  const locationIds = locationRows.map((row) => row.id);

  if (locationIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({ storageKey: locationPlans.storageKey })
    .from(locationPlans)
    .where(inArray(locationPlans.locationId, locationIds));

  return rows.map((row) => row.storageKey);
}

export function isClientOwnedPlanKey(clientId: string, storageKey: string) {
  return storageKey.startsWith(`clients/${clientId}/`);
}

/** Canonical upload keys under locations/.../plans/ — safe to delete on replace. Fixture site-plans/ keys are kept. */
export function isManagedLocationPlanKey(storageKey: string) {
  return /\/locations\/[^/]+\/plans\//.test(storageKey);
}
