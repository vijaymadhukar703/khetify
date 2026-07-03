const crypto = require("crypto");

/**
 * AES-256-GCM encryption for channel credentials. The key is derived from the
 * MASTER_KEY env var (scrypt). Output format: base64(iv).base64(tag).base64(ct).
 * NEVER log plaintext credentials or the master key.
 */
function keyBuf() {
  const master = process.env.MASTER_KEY || "dev-master-key-change-me";
  return crypto.scryptSync(master, "khetify-channel-creds", 32);
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

function decrypt(blob) {
  if (!blob) return null;
  const [ivB, tagB, ctB] = String(blob).split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

const encryptJSON = (obj) => encrypt(JSON.stringify(obj));
const decryptJSON = (blob) => { const s = decrypt(blob); return s ? JSON.parse(s) : null; };

module.exports = { encrypt, decrypt, encryptJSON, decryptJSON };
