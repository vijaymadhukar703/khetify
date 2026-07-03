const User = require("../model/User/User");
const { ROLE_CAPABILITIES } = require("../config/permissions");

/**
 * Warehouse-level access control — an EXTENSION of role-based access, not a
 * replacement. authorize() still decides WHAT a role may do; this decides
 * WHICH warehouses the data may come from.
 *
 * Rules:
 *  - "*" roles (company_admin, super_admin) and auditors are NEVER scoped —
 *    they see every warehouse.
 *  - Any other user WITH assigned warehouseIds is scoped to exactly those.
 *  - A user WITHOUT assignments is unscoped (legacy behaviour preserved —
 *    existing users keep working until the admin assigns them).
 *
 * Returns `null` for unscoped access, or an array of warehouse-id strings.
 * Callers turn that into a Mongo `$in` filter / membership check.
 */
async function warehouseScope(reqUser) {
  if (!reqUser) return null;
  const caps = ROLE_CAPABILITIES[reqUser.role] || [];
  if (caps.includes("*") || reqUser.role === "auditor") return null;

  // ALWAYS read the live User doc — JWTs carry a snapshot of warehouseIds
  // from login time, so trusting the token would make (re)assignments only
  // apply after the manager logs out and back in. One indexed query.
  // Owner-aware: a seller principal (e.g. seller_manager) is a User owned by the
  // seller account (ownerType "seller", ownerId = sellerId); a company user is
  // keyed by companyId. seller_admin/company_admin hold "*" and returned above.
  const filter = reqUser.principalType === "seller"
    ? { _id: reqUser.id, ownerType: "seller", ownerId: reqUser.sellerId }
    : { _id: reqUser.id, companyId: reqUser.companyId };
  const user = await User.findOne(filter).select("warehouseIds");
  const scope = (user?.warehouseIds || []).map(String).filter(Boolean);
  return scope.length ? scope : null;
}

/** Membership check used by receipt verification and similar guards. */
function inScope(scope, warehouseId) {
  if (!scope) return true; // unscoped
  return warehouseId != null && scope.includes(String(warehouseId));
}

module.exports = { warehouseScope, inScope };
