import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../config/env.js";

const LOGO_URL_SECONDS = 60 * 60;

export class AssetStorageError extends Error {
  constructor() {
    super("Logo storage is unavailable.");
    this.name = "AssetStorageError";
  }
}

export function createAssetStorage(env: Env) {
  const client = new S3Client({
    region: env.AWS_REGION,
    endpoint: env.AWS_ENDPOINT_URL_S3,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  const bucket = env.ASSETS_BUCKET;

  return {
    async putLogo(clientId: string, body: Uint8Array, contentType: string) {
      const key = logoKey(clientId);

      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
          }),
        );
      } catch (error) {
        console.error("Failed to store client logo", error);
        throw new AssetStorageError();
      }

      return key;
    },

    async deleteObject(key: string) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        console.error("Failed to delete stored object", error);
        throw new AssetStorageError();
      }
    },

    async logoUrl(key: string | null) {
      if (!key) {
        return null;
      }

      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: LOGO_URL_SECONDS,
      });
    },
  };
}

export type AssetStorage = ReturnType<typeof createAssetStorage>;

function logoKey(clientId: string) {
  return `clients/${clientId}/logo`;
}
