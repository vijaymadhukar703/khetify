import config from "../../config/config";

// Some products in the DB were uploaded BEFORE the path-storage fix and have
// absolute filesystem paths stored in productImages[]. New uploads store the
// clean "uploads/products/<filename>" form. This helper tolerates both, plus
// already-absolute http(s) URLs and paths that begin with "/uploads".
const IMG_BASE = String(config.BASE_URL || "").replace(/\/api\/?$/, "").replace(/\/$/, "");

export function getProductImage(src) {
  if (!src) return null;
  // Normalize backslashes to slashes.
  let s = String(src).replace(/\\/g, "/");
  // Already an absolute URL → use as-is.
  if (/^https?:\/\//i.test(s)) return s;
  // Strip any absolute filesystem prefix and keep only the uploads/... tail.
  const idx = s.toLowerCase().indexOf("uploads/");
  if (idx >= 0) s = s.slice(idx);
  // Ensure a single leading slash for the join.
  if (!s.startsWith("/")) s = "/" + s;
  return `${IMG_BASE}${s}`;
}
