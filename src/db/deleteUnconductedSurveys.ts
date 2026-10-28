import { and, eq, inArray, isNull } from "drizzle-orm";
import { surveyRecords } from "./schema/index.js";
import type { Database } from "./types.js";

type SurveyDb = Pick<Database, "select" | "delete">;

/** Removes survey rows that were never conducted for the given project–asset pairs. */
export async function deleteUnconductedSurveys(
  db: SurveyDb,
  pairs: { projectId: string; assetId: string }[],
) {
  if (pairs.length === 0) {
    return;
  }

  const projectIds = [...new Set(pairs.map((pair) => pair.projectId))];
  const assetIds = [...new Set(pairs.map((pair) => pair.assetId))];
  const pairKeys = new Set(pairs.map((pair) => `${pair.projectId}:${pair.assetId}`));

  const candidates = await db
    .select({
      id: surveyRecords.id,
      projectId: surveyRecords.projectId,
      assetId: surveyRecords.assetId,
    })
    .from(surveyRecords)
    .where(
      and(
        inArray(surveyRecords.projectId, projectIds),
        inArray(surveyRecords.assetId, assetIds),
        eq(surveyRecords.status, "not_started"),
        isNull(surveyRecords.surveyedAt),
      ),
    );

  const ids = candidates
    .filter((row) => pairKeys.has(`${row.projectId}:${row.assetId}`))
    .map((row) => row.id);

  if (ids.length === 0) {
    return;
  }

  await db.delete(surveyRecords).where(inArray(surveyRecords.id, ids));
}
