import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const need = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set. See .env.example.`);
    return value;
  };
  return {
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION || "auto",
    bucket: need("S3_BUCKET"),
    accessKeyId: need("S3_ACCESS_KEY_ID"),
    secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  };
}

export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type Storage = ReturnType<typeof createStorage>;

export function createStorage(config: StorageConfig) {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Only send checksums when an operation requires them; presigned PUTs from browsers can't add them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = config.bucket;

  return {
    /**
     * A URL the client can PUT exactly one object to. Content-Type and Content-Length are
     * part of the signature, so a different type or size is rejected by storage (D-132).
     */
    presignUpload(key: string, contentType: string, size: number) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: size }), {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        signableHeaders: new Set(["content-type", "content-length"]),
      });
    },

    presignDownload(key: string, ttlSeconds = DOWNLOAD_URL_TTL_SECONDS) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: ttlSeconds });
    },

    async head(key: string): Promise<{ size: number; contentType: string | undefined } | null> {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: res.ContentLength ?? 0, contentType: res.ContentType };
      } catch (error) {
        if (error instanceof NotFound || (error as { name?: string }).name === "NotFound") return null;
        throw error;
      }
    },

    async read(key: string): Promise<Buffer> {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!res.Body) throw new Error(`Empty object: ${key}`);
      return Buffer.from(await res.Body.transformToByteArray());
    },

    async write(key: string, body: Buffer, contentType: string) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },

    async remove(key: string) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
