const { capabilitiesForRole, ROLE_CAPABILITIES, deniedForRole } = require("../../config/permissions");
const User = require("../../model/User/User");

/**
 * GET /api/auth/me
 * Returns the authenticated principal's identity + capability list so the
 * frontend can drive UI gating (usePermission). The capability list is the
 * SAME source the backend authorize() enforces, so UI and API never drift.
 * Also returns warehouseIds (warehouse-level access) so the UI can scope
 * itself the same way services/warehouseScope.js scopes the API.
 */
exports.me = async (req, res) => {
  const { id, companyId, role } = req.user;

  // "*" roles are never warehouse-scoped. For team roles, read the live User
  // doc so a reassignment takes effect without waiting for token re-issue.
  let warehouseIds = [];
  const caps = ROLE_CAPABILITIES[role] || [];
  if (!caps.includes("*") && role !== "auditor") {
    const user = await User.findOne({ _id: id, companyId }).select("warehouseIds").catch(() => null);
    warehouseIds = (user?.warehouseIds || req.user.warehouseIds || []).map(String);
  }

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
    },
  });
};
