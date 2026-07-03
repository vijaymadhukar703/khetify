// Shared capability resolver — MIRRORS backend config/permissions.js
// hasCapability(). Used by BOTH the company PermissionContext and the seller
// SellerPermissionContext so UI gating matches what the API enforces. UI gating
// is convenience only; the backend is the real enforcement point.
export const READONLY_SUFFIXES = [":read", ":view", ":export", ":read_own"];

export function resolveCapability(role, capabilities, denied, capability) {
  if (!capability) return true; // no requirement = always allowed
  if (!Array.isArray(capabilities)) return false;
  // Explicit deny beats any wildcard (mirrors backend deniedForRole).
  if (Array.isArray(denied) && denied.includes(capability)) return false;
  if (capabilities.includes("*")) return true;
  if (capabilities.includes(capability)) return true;
  const entity = capability.split(":")[0];
  if (capabilities.includes(`${entity}:*`)) return true;
  if (role === "auditor") {
    return READONLY_SUFFIXES.some((s) => capability.endsWith(s)) && capabilities.includes(capability);
  }
  return false;
}
