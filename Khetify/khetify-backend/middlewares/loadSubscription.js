const { ensureSubscription, ownerFromUser } = require("../services/subscriptionService");

/**
 * Loads (or lazily creates) the authenticated PRINCIPAL's subscription onto
 * req.subscription. Owner-aware: a seller token loads the seller's
 * subscription (SELLER_PLANS); a company/team token loads the company's. Must
 * run AFTER authMiddleware.
 */
module.exports = async function loadSubscription(req, res, next) {
  try {
    const owner = ownerFromUser(req.user);
    if (!owner.ownerId) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }
    req.subscription = await ensureSubscription(owner);
    next();
  } catch (err) {
    console.error("loadSubscription error:", err);
    res.status(500).json({ success: false, message: "Subscription lookup failed" });
  }
};
