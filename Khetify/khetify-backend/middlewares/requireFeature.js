const { effectivePlan, featuresForSub } = require("../services/subscriptionService");

/**
 * Gate a route behind a feature. Requires loadSubscription to have run first.
 * Owner-aware: resolves the feature list from the subscription's owner type
 * (seller subs use SELLER_PLANS), via subscriptionService.featuresForSub.
 *
 *   router.post("/warehouse", auth, loadSubscription,
 *     requireFeature(FEATURES.MULTI_WAREHOUSE), createWarehouse);
 */
module.exports = function requireFeature(feature) {
  return (req, res, next) => {
    const sub = req.subscription;
    if (!sub) {
      return res.status(500).json({
        success: false,
        message: "requireFeature used without loadSubscription",
      });
    }

    if (!featuresForSub(sub).includes(feature)) {
      return res.status(403).json({
        success: false,
        code: "UPGRADE_REQUIRED",
        message: `Your ${effectivePlan(sub)} plan does not include this feature.`,
        requiredFeature: feature,
      });
    }
    next();
  };
};
