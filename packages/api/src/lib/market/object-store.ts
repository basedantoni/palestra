import { AwsClient } from "aws4fetch";

/** Where raw Marketplace and ECB responses land before deriving (ADR 0008). */
export type ObjectStore = {
  put(key: string, body: Uint8Array): Promise<void>;
  /** The object's bytes, or null when there is no such key. */
  get(key: string): Promise<Uint8Array | null>;
};

/**
 * An S3 bucket (Tigris in production), path-style. Objects are written without an ACL, so they
 * stay as private as the bucket: never served.
 */
export function s3Store(config: {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): ObjectStore {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });
  const url = (key: string) => `${config.endpoint.replace(/\/$/, "")}/${config.bucket}/${key}`;

  return {
    async put(key, body) {
      const res = await aws.fetch(url(key), { method: "PUT", body, headers: { "content-type": "application/gzip" } });
      if (!res.ok) throw new Error(`Object store PUT ${key} failed: ${res.status} ${await res.text()}`);
    },
    async get(key) {
      const res = await aws.fetch(url(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Object store GET ${key} failed: ${res.status} ${await res.text()}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
