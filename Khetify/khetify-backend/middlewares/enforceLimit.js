const Warehouse = require("../model/Warehouse/Warehouse");
const Product = require("../model/Company/productModel");
const Customer = require("../model/Sales/Customer");
const { ownerFromUser } = require("../services/subscriptionService");

/**
 * Enforce count-based plan limits (e.g. free = 1 warehouse, 50 customers).
 * Owner-aware: counts the authenticated principal's own resources (a seller
 * counts sellerId-owned rows; a company counts companyId-owned rows). Requires
 * loadSubscription to have run first.
 *
 *   router.post("/warehouse", auth, loadSubscription,
 *     enforceLimit("warehouses"), createWarehouse);
 */
const counters = {
  warehouses: ({ ownerType, ownerId }) =>
    Warehouse.countDocuments(ownerType === "seller" ? { sellerId: ownerId } : { companyId: ownerId }),
  products: ({ ownerId }) => Product.countDocuments({ companyId: ownerId }), // company-only resource
  customers: ({ ownerType, ownerId }) => Customer.countDocuments({ ownerType, ownerId }),
};

module.exports = function enforceLimit(resource) {
  return async (req, res, next) => {
    try {
      const sub = req.subscription;
      const limit = sub && sub.limits ? sub.limits[resource] : undefined;
      if (limit === undefined || limit === Infinity || limit === null) return next();

      const count = await counters[resource](ownerFromUser(req.user));
      if (count >= limit) {
        return res.status(403).json({
          success: false,
          code: "LIMIT_REACHED",
          message: `Your plan allows up to ${limit} ${resource}. Upgrade to add more.`,
          resource,
          limit,
        });
      }
      next();
    } catch (err) {
      console.error("enforceLimit error:", err);
      res.status(500).json({ success: false, message: "Limit check failed" });
    }
  };
};
