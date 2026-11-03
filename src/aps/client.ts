import { AuthenticationClient, Scopes } from "@aps_sdk/authentication";
import { ModelDerivativeClient, OutputType, View } from "@aps_sdk/model-derivative";
import { OssClient, PolicyKey, Region } from "@aps_sdk/oss";
import type { Env } from "../config/env.js";

export type ApsTranslationStatus = "pending" | "inprogress" | "success" | "failed" | "timeout";

export type ApsViewerToken = {
  accessToken: string;
  expiresIn: number;
};

export type ApsUploadResult = {
  objectKey: string;
  objectId: string;
  urn: string;
};

export type ApsManifestStatus = {
  status: ApsTranslationStatus;
  progress: string;
  messages: string[];
};

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

const TOKEN_SKEW_MS = 60_000;

export type ApsClient = {
  configured: true;
  bucket: string;
  getViewerToken(): Promise<ApsViewerToken>;
  uploadObject(objectKey: string, bytes: Uint8Array, contentType?: string): Promise<ApsUploadResult>;
  startTranslation(urn: string): Promise<void>;
  getManifestStatus(urn: string): Promise<ApsManifestStatus | null>;
} | {
  configured: false;
};

export function createApsClient(env: Env): ApsClient {
  if (!env.APS_CLIENT_ID || !env.APS_CLIENT_SECRET || !env.APS_BUCKET) {
    return { configured: false };
  }

  const clientId = env.APS_CLIENT_ID;
  const clientSecret = env.APS_CLIENT_SECRET;
  const bucket = env.APS_BUCKET;
  const authenticationClient = new AuthenticationClient();
  const ossClient = new OssClient();
  const modelDerivativeClient = new ModelDerivativeClient();

  let internalToken: CachedToken | null = null;
  let bucketReady = false;

  async function getInternalToken() {
    const now = Date.now();

    if (internalToken && internalToken.expiresAtMs > now + TOKEN_SKEW_MS) {
      return internalToken.accessToken;
    }

    const token = await authenticationClient.getTwoLeggedToken(clientId, clientSecret, [
      Scopes.DataRead,
      Scopes.DataCreate,
      Scopes.DataWrite,
      Scopes.BucketCreate,
      Scopes.BucketRead,
    ]);

    internalToken = {
      accessToken: token.access_token,
      expiresAtMs: now + token.expires_in * 1000,
    };

    return internalToken.accessToken;
  }

  async function ensureBucket() {
    if (bucketReady) {
      return;
    }

    const accessToken = await getInternalToken();

    try {
      await ossClient.getBucketDetails(bucket, { accessToken });
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }

      await ossClient.createBucket(
        Region.Us,
        {
          bucketKey: bucket,
          policyKey: PolicyKey.Persistent,
        },
        { accessToken },
      );
    }

    bucketReady = true;
  }

  return {
    configured: true,
    bucket,

    async getViewerToken() {
      const token = await authenticationClient.getTwoLeggedToken(clientId, clientSecret, [
        Scopes.ViewablesRead,
      ]);

      return {
        accessToken: token.access_token,
        expiresIn: token.expires_in,
      };
    },

    async uploadObject(objectKey, bytes, contentType = "application/acad") {
      await ensureBucket();
      const accessToken = await getInternalToken();
      const details = await ossClient.uploadObject(bucket, objectKey, Buffer.from(bytes), {
        accessToken,
        xAdsMetaContentType: contentType,
      });

      if (!details.objectId) {
        throw new Error("APS upload did not return an object id.");
      }

      return {
        objectKey: details.objectKey ?? objectKey,
        objectId: details.objectId,
        urn: urnify(details.objectId),
      };
    },

    async startTranslation(urn) {
      const accessToken = await getInternalToken();
      await modelDerivativeClient.startJob(
        {
          input: { urn },
          output: {
            formats: [
              {
                type: OutputType.Svf2,
                views: [View._2d, View._3d],
              },
            ],
          },
        },
        { accessToken },
      );
    },

    async getManifestStatus(urn) {
      const accessToken = await getInternalToken();

      try {
        const manifest = await modelDerivativeClient.getManifest(urn, { accessToken });
        return {
          status: normalizeStatus(manifest.status),
          progress: manifest.progress || "unknown",
          messages: collectManifestMessages(manifest),
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}

export function urnify(objectId: string) {
  return Buffer.from(objectId).toString("base64url");
}

export function apsObjectKeyForPlan(clientId: string, planId: string) {
  return `${clientId}/${planId}.dwg`;
}

function normalizeStatus(status: string): ApsTranslationStatus {
  switch (status) {
    case "pending":
    case "inprogress":
    case "success":
    case "failed":
    case "timeout":
      return status;
    default:
      return "failed";
  }
}

function collectManifestMessages(manifest: { derivatives?: Array<{ messages?: unknown }> }) {
  const messages: string[] = [];

  for (const derivative of manifest.derivatives ?? []) {
    for (const message of flattenMessages(derivative.messages)) {
      messages.push(message);
    }
  }

  return messages;
}

function flattenMessages(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenMessages(entry));
  }

  if (typeof value === "object" && "message" in value && typeof value.message === "string") {
    return [value.message];
  }

  return [];
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("axiosError" in error) {
    const axiosError = (error as { axiosError?: { response?: { status?: number } } }).axiosError;
    if (axiosError?.response?.status === 404) {
      return true;
    }
  }

  if ("response" in error) {
    const response = (error as { response?: { status?: number } }).response;
    if (response?.status === 404) {
      return true;
    }
  }

  return false;
}
