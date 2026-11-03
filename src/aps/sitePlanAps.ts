import { eq } from "drizzle-orm";
import type { AssetStorage } from "../storage/assets.js";
import { PLAN_ACAD_CONTENT_TYPE } from "../db/locationPlanHelpers.js";
import { locationPlans } from "../db/schema/index.js";
import type { Database } from "../db/types.js";
import {
  apsObjectKeyForPlan,
  type ApsClient,
  type ApsTranslationStatus,
} from "./client.js";

export type SitePlanApsFields = {
  apsObjectKey: string | null;
  apsUrn: string | null;
  apsTranslationStatus: ApsTranslationStatus | null;
  apsTranslationError: string | null;
};

export const emptySitePlanApsFields: SitePlanApsFields = {
  apsObjectKey: null,
  apsUrn: null,
  apsTranslationStatus: null,
  apsTranslationError: null,
};

export async function syncSitePlanApsTranslation(options: {
  aps: ApsClient;
  db: Database;
  storage: AssetStorage;
  planId: string;
  clientId: string;
  contentType: string;
  storageKey: string;
  bytes?: Uint8Array;
}): Promise<SitePlanApsFields> {
  const { aps, db, storage, planId, clientId, contentType, storageKey } = options;

  if (contentType !== PLAN_ACAD_CONTENT_TYPE) {
    await db
      .update(locationPlans)
      .set({ ...emptySitePlanApsFields, updatedAt: new Date() })
      .where(eq(locationPlans.id, planId));
    return emptySitePlanApsFields;
  }

  if (!aps.configured) {
    return emptySitePlanApsFields;
  }

  await db
    .update(locationPlans)
    .set({
      apsObjectKey: null,
      apsUrn: null,
      apsTranslationStatus: "pending",
      apsTranslationError: null,
      updatedAt: new Date(),
    })
    .where(eq(locationPlans.id, planId));

  try {
    const bytes = options.bytes ?? (await storage.getObjectBytes(storageKey));
    const objectKey = apsObjectKeyForPlan(clientId, planId);
    const uploaded = await aps.uploadObject(objectKey, bytes, PLAN_ACAD_CONTENT_TYPE);
    await aps.startTranslation(uploaded.urn);

    const fields: SitePlanApsFields = {
      apsObjectKey: uploaded.objectKey,
      apsUrn: uploaded.urn,
      apsTranslationStatus: "inprogress",
      apsTranslationError: null,
    };

    await db
      .update(locationPlans)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(locationPlans.id, planId));

    return fields;
  } catch (error) {
    const message = errorMessage(error);
    console.error("Failed to start APS translation for site plan", planId, error);

    const fields: SitePlanApsFields = {
      apsObjectKey: null,
      apsUrn: null,
      apsTranslationStatus: "failed",
      apsTranslationError: message,
    };

    await db
      .update(locationPlans)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(locationPlans.id, planId));

    return fields;
  }
}

export async function refreshSitePlanApsStatus(options: {
  aps: ApsClient;
  db: Database;
  planId: string;
  apsUrn: string | null;
  apsTranslationStatus: string | null;
}): Promise<Pick<SitePlanApsFields, "apsTranslationStatus" | "apsTranslationError"> | null> {
  const { aps, db, planId, apsUrn, apsTranslationStatus } = options;

  if (!aps.configured || !apsUrn) {
    return null;
  }

  if (
    apsTranslationStatus === "success" ||
    apsTranslationStatus === "failed" ||
    apsTranslationStatus === "timeout"
  ) {
    return null;
  }

  try {
    const manifest = await aps.getManifestStatus(apsUrn);

    if (!manifest) {
      return null;
    }

    const fields = {
      apsTranslationStatus: manifest.status,
      apsTranslationError:
        manifest.status === "failed" || manifest.status === "timeout"
          ? manifest.messages[0] ?? `APS translation ${manifest.status}.`
          : null,
    };

    await db
      .update(locationPlans)
      .set({
        ...fields,
        updatedAt: new Date(),
      })
      .where(eq(locationPlans.id, planId));

    return fields;
  } catch (error) {
    console.error("Failed to refresh APS translation status", planId, error);
    return null;
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 1000);
  }

  return "APS translation failed.";
}
