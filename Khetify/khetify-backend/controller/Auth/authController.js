const { capabilitiesForRole, ROLE_CAPABILITIES, deniedForRole } = require("../../config/permissions");
const User = require("../../model/User/User");
const Company = require("../../model/Company/Company");
const Warehouse = require("../../model/Warehouse/Warehouse");

/**
 * The company's BUSINESS name. `fullName` is an auth field — the account
 * holder's own name ("Aakash") — while companyInfo.companyName is the business
 * ("Khetify Agro Pvt. Ltd."). Same resolver already used by pcService and the
 * seller-facing company endpoints, so every surface names a company identically.
 * Returns null (not "Company") when neither exists: the header must be able to
 * tell "no business name on file" from a real one and show nothing instead.
 */
const businessNameOf = (c) => c?.companyInfo?.companyName || c?.fullName || null;

/**
 * GET /api/auth/me
 * Returns the authenticated principal's identity + capability list so the
 * frontend can drive UI gating (usePermission). The capability list is the
 * SAME source the backend authorize() enforces, so UI and API never drift.
 * Also returns warehouseIds (warehouse-level access) so the UI can scope
 * itself the same way services/warehouseScope.js scopes the API.
 *
 * ADDITIVE identity fields (all optional, no existing key changed):
 *   name         — the PERSON: the account holder's fullName for a company
 *                  owner, the User's own name for a team member.
 *   companyName  — the business this principal belongs to.
 *   warehouses   — [{ _id, name }] for the assigned warehouseIds, so a warehouse
 *                  user's header can name their warehouse. The session carried
 *                  IDs only, and every consumer needed a second round-trip to
 *                  GET /api/warehouse just to resolve a name.
 * Served from here because PermissionContext already fetches this on every load,
 * and because a header sourced from a login-time localStorage snapshot goes stale
 * the moment a user is renamed or reassigned.
 */
exports.me = async (req, res) => {
  const { id, companyId, role } = req.user;

  // Company-owner tokens are signed with id === companyId (see CLAUDE.md), so
  // the owner has no User doc — their name lives on the Company.
  const isOwner = String(id) === String(companyId);

  // ONE read of the team-member doc, reused for BOTH the display name and the
  // warehouse scope (the scope already needed it). Skipped for the owner, whose
  // lookup could only ever miss.
  const user = isOwner
    ? null
    : await User.findOne({ _id: id, companyId }).select("name warehouseIds").catch(() => null);

  // "*" roles are never warehouse-scoped. For team roles, read the live User
  // doc so a reassignment takes effect without waiting for token re-issue.
  let warehouseIds = [];
  const caps = ROLE_CAPABILITIES[role] || [];
  if (!caps.includes("*") && role !== "auditor") {
    warehouseIds = (user?.warehouseIds || req.user.warehouseIds || []).map(String);
  }

  const company = await Company.findById(companyId)
    .select("fullName companyInfo.companyName")
    .lean()
    .catch(() => null);

  // Scoped by companyId as well as _id — never trust an ID from a token to
  // reach across tenants (multi-tenancy invariant).
  const warehouses = warehouseIds.length
    ? (await Warehouse.find({ _id: { $in: warehouseIds }, companyId })
        .select("name")
        .lean()
        .catch(() => []))
      .map((w) => ({ _id: String(w._id), name: w.name }))
    : [];

  res.json({
    success: true,
    data: {
      id,
      companyId,
      role,
      capabilities: capabilitiesForRole(role),
      // Capabilities explicitly denied to this role despite any wildcard
      // (e.g. company_admin is denied inventory:transfer). The UI must honor
      // these the same way backend hasCapability() does.
      deniedCapabilities: deniedForRole(role),
      warehouseIds,
      name: (isOwner ? company?.fullName : user?.name) || null,
      companyName: businessNameOf(company),
      warehouses,
    },
  });
};
