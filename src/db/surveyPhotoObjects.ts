import { eq } from "drizzle-orm";
import type { AssetStorage } from "../storage/assets.js";
import { projects, surveyRecordPhotos, surveyRecords } from "./schema/index.js";
import type { Database } from "./types.js";

export async function removeSurveyPhotos(db: Database, storage: AssetStorage, scope: SurveyPhotoScope) {
  const rows = await photoKeys(db, scope);

  for (const row of rows) {
    await storage.deleteObject(row.storageKey);
  }
}

type SurveyPhotoScope =
  | { surveyRecordId: string }
  | { projectId: string }
  | { assetId: string }
  | { clientId: string };

function photoKeys(db: Database, scope: SurveyPhotoScope) {
  const query = db.select({ storageKey: surveyRecordPhotos.storageKey }).from(surveyRecordPhotos);

  if ("surveyRecordId" in scope) {
    return query.where(eq(surveyRecordPhotos.surveyRecordId, scope.surveyRecordId));
  }

  if ("projectId" in scope) {
    return query
      .innerJoin(surveyRecords, eq(surveyRecordPhotos.surveyRecordId, surveyRecords.id))
      .where(eq(surveyRecords.projectId, scope.projectId));
  }

  if ("assetId" in scope) {
    return query
      .innerJoin(surveyRecords, eq(surveyRecordPhotos.surveyRecordId, surveyRecords.id))
      .where(eq(surveyRecords.assetId, scope.assetId));
  }

  return query
    .innerJoin(surveyRecords, eq(surveyRecordPhotos.surveyRecordId, surveyRecords.id))
    .innerJoin(projects, eq(surveyRecords.projectId, projects.id))
    .where(eq(projects.clientId, scope.clientId));
}
