const { ROLES, hasCapability } = require("../config/permissions");

/**
 * Access control. Accepts EITHER:
 *   - capability strings  authorize("grn:post", "grn:create")  ← new style
 *   - legacy role names   authorize("company_admin")           ← still works
 *
 * Capability strings (those containing ":") are resolved per-role through
 * config/permissions.js. Bare role names are matched against req.user.role
 * exactly, preserving the old behaviour of every existing call site.
 *
 * A request passes if ANY of the listed requirements is satisfied.
 *
 * Backward compatibility: company tokens issued before Sprint 0 carried no
 * role; authMiddleware now backfills role = "company_admin", which holds "*".
 */
module.exports = function authorize(...requirements) {
  return (req, res, next) => {
    const role = (req.user && req.user.role) || "company_admin";

    if (requirements.length === 0) return next();

    const ok = requirements.some((req_) => {
      const isCapability = typeof req_ === "string" && req_.includes(":");
      if (isCapability) return hasCapability(role, req_);
      // legacy role-name check
      if (ROLES.includes(req_)) return role === req_;
      // unknown token — treat as capability to be safe
      return hasCapability(role, req_);
    });

    if (ok) return next();
    return res.status(403).json({ success: false, message: "Forbidden" });
  };
};
