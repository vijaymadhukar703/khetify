const pcService = require("../services/pcService");

/**
 * Gate a seller action on holding an ACTIVE (non-expired, non-revoked) Principal
 * Certificate for the target company. `getCompanyId(req)` resolves the company
 * (defaults to body.companyId / params.companyId). The PC is the source of
 * truth for marketplace authorization (alongside an active subscription, which
 * the subscription middleware enforces separately).
 *
 *   router.post("/publish", auth, requireApprovedSeller, requireActivePC(), ctrl.publish)
 */
module.exports = function requireActivePC(getCompanyId) {
  return async (req, res, next) => {
    try {
      const companyId = typeof getCompanyId === "function" ? getCompanyId(req) : (req.body?.companyId || req.params?.companyId);
      if (!companyId) return res.status(400).json({ success: false, message: "companyId is required" });
      const ok = await pcService.hasActivePc(req.user.sellerId, companyId);
      if (!ok) {
        return res.status(403).json({
          success: false,
          code: "NO_ACTIVE_PC",
          message: "An active Principal Certificate for this company is required to list its products.",
        });
      }
      req.pcCompanyId = String(companyId);
      next();
    } catch (err) {
      res.status(500).json({ success: false, message: err.message || "Server error" });
    }
  };
};
