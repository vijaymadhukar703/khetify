const crypto = require("crypto");
const ApiKey = require("../model/Integration/ApiKey");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const SCOPES = ["pos:sync", "orders:write", "inventory:read"];

/** Create a key; returns the PLAINTEXT once (never retrievable again). */
async function createKey(companyId, { name, scopes = ["pos:sync"] }) {
  if (!name) throw httpErr("name is required");
  const bad = scopes.filter((s) => !SCOPES.includes(s));
  if (bad.length) throw httpErr(`Unknown scope(s): ${bad.join(", ")}`);
  const plain = `khk_${crypto.randomBytes(24).toString("hex")}`;
  const doc = await ApiKey.create({ companyId, name, prefix: plain.slice(0, 12), keyHash: sha256(plain), scopes });
  return { key: plain, id: doc._id, prefix: doc.prefix, scopes: doc.scopes };
}

async function listKeys(companyId) {
  return ApiKey.find({ companyId }).select("-keyHash").sort({ createdAt: -1 });
}

async function revokeKey(companyId, id) {
  const k = await ApiKey.findOneAndUpdate({ _id: id, companyId }, { isActive: false }, { new: true });
  if (!k) throw httpErr("Key not found", 404);
  return k;
}

/** Resolve a plaintext key to its active record (used by apiKeyAuth). */
async function resolveKey(plain) {
  if (!plain) return null;
  const k = await ApiKey.findOne({ keyHash: sha256(plain), isActive: true });
  if (k) ApiKey.updateOne({ _id: k._id }, { lastUsedAt: new Date() }).catch(() => {});
  return k;
}

module.exports = { createKey, listKeys, revokeKey, resolveKey, SCOPES };
