const { ensureSubscription, effectivePlan, changePlan } = require("../../services/subscriptionService");
const { resolveSellerFeatures, resolveSellerLimits, SELLER_PLANS } = require("../../config/plans");

const sellerOwner = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });

/** GET /api/seller/subscription/me — drives seller feature gating. */
exports.getMySubscription = async (req, res) => {
  try {
    const sub = await ensureSubscription(sellerOwner(req));
    const plan = effectivePlan(sub);
    res.json({
      success: true,
      data: {
        plan,
        status: sub.status,
        features: resolveSellerFeatures(plan),
        limits: resolveSellerLimits(plan),
        currentPeriodEnd: sub.currentPeriodEnd,
      },
    });
  } catch (err) {
    console.error("seller getMySubscription error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/seller/subscription/plans — seller plan catalog. */
exports.getPlans = (req, res) => {
  res.json({ success: true, data: SELLER_PLANS });
};

/** POST /api/seller/subscription/change { plan } — dev/manual switch (real payment later). */
exports.changePlan = async (req, res) => {
  try {
    const sub = await changePlan(sellerOwner(req), req.body.plan);
    res.json({ success: true, message: `Switched to ${req.body.plan}`, data: sub });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
