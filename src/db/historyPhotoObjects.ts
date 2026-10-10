import { eq } from "drizzle-orm";
import { assets, locations, maintenanceHistory, maintenanceHistoryPhotos, sites } from "./schema/index.js";
import type { AssetStorage } from "../storage/assets.js";
import type { Database } from "./types.js";

export async function removeHistoryPhotos(db: Database, storage: AssetStorage, scope: HistoryPhotoScope) {
  const rows = await photoKeys(db, scope);

  for (const row of rows) {
    await storage.deleteObject(row.storageKey);
  }
}

type HistoryPhotoScope =
  | { historyId: string }
  | { assetId: string }
  | { locationId: string }
  | { clientId: string };

function photoKeys(db: Database, scope: HistoryPhotoScope) {
  const query = db.select({ storageKey: maintenanceHistoryPhotos.storageKey }).from(maintenanceHistoryPhotos);

  if ("historyId" in scope) {
    return query.where(eq(maintenanceHistoryPhotos.maintenanceHistoryId, scope.historyId));
  }

  if ("assetId" in scope) {
    return query
      .innerJoin(maintenanceHistory, eq(maintenanceHistoryPhotos.maintenanceHistoryId, maintenanceHistory.id))
      .where(eq(maintenanceHistory.assetId, scope.assetId));
  }

  if ("locationId" in scope) {
    return query
      .innerJoin(maintenanceHistory, eq(maintenanceHistoryPhotos.maintenanceHistoryId, maintenanceHistory.id))
      .innerJoin(assets, eq(maintenanceHistory.assetId, assets.id))
      .where(eq(assets.locationId, scope.locationId));
  }

  return query
    .innerJoin(maintenanceHistory, eq(maintenanceHistoryPhotos.maintenanceHistoryId, maintenanceHistory.id))
    .innerJoin(assets, eq(maintenanceHistory.assetId, assets.id))
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .innerJoin(sites, eq(locations.siteId, sites.id))
    .where(eq(sites.clientId, scope.clientId));
}
