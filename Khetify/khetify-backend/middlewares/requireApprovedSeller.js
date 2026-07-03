const Seller = require("../model/Seller/Seller");

/**
 * Gate: allow only an APPROVED seller principal through.
 *
 * Apply to seller endpoints that depend on the supplying-company relationship
 * (supply requests, catalog, inventory — arriving in Phase 2b/2c). Onboarding,
 * /seller/link, /seller/companies and /seller/me must NOT use this — those are
 * how an unapproved seller gets approved in the first place.
 *
 * Assumes authMiddleware ran first (so req.user is populated).
 */
module.exports = async function requireApprovedSeller(req, res, next) {
  try {
    if (!req.user || req.user.principalType !== "seller" || !req.user.sellerId) {
      return res.status(403).json({ success: false, message: "Seller access only" });
    }
    const seller = await Seller.findById(req.user.sellerId).select("linkStatus");
    if (!seller || seller.linkStatus !== "approved") {
      return res.status(403).json({
        success: false,
        code: "SELLER_NOT_APPROVED",
        message: "Your supplying company has not approved you yet.",
      });
    }
    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
