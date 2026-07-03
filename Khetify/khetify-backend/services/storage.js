const fs = require("fs");
const path = require("path");

/**
 * Storage abstraction with an env-switchable driver (STORAGE_DRIVER):
 *   - "local" (default): files on disk under /uploads, served by express.static
 *   - "s3": S3-compatible object storage (lazy-loads @aws-sdk/client-s3)
 *
 * Keeps local for dev; production sets STORAGE_DRIVER=s3 + S3_* env vars.
 */
const DRIVER = process.env.STORAGE_DRIVER || "local";

async function saveLocal(buffer, key) {
  const dest = path.join(__dirname, "../uploads", key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
  return `/uploads/${key}`;
}

async function saveS3(buffer, key, contentType) {
  let S3;
  try { S3 = require("@aws-sdk/client-s3"); }
  catch { const e = new Error("STORAGE_DRIVER=s3 requires @aws-sdk/client-s3 to be installed"); e.status = 500; throw e; }
  const client = new S3.S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
    forcePathStyle: !!process.env.S3_ENDPOINT,
  });
  await client.send(new S3.PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  const base = process.env.S3_PUBLIC_URL || `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com`;
  return `${base}/${key}`;
}

/** Persist a file buffer; returns its public URL/path. */
async function save(buffer, key, contentType = "application/octet-stream") {
  return DRIVER === "s3" ? saveS3(buffer, key, contentType) : saveLocal(buffer, key);
}

module.exports = { save, DRIVER };
