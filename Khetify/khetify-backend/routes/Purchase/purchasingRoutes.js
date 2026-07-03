const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");

const {
  getVendors,
  createVendor,
  getPurchaseOrders,
  createPurchaseOrder,
  updatePurchaseOrderStatus,
} = require("../../controller/Purchase/purchasingController");

// Purchasing is a premium workflow (matches plans.js SUPPLY_WORKFLOW).
const premium = [auth, loadSubscription, requireFeature(FEATURES.SUPPLY_WORKFLOW)];

router.get("/vendors", auth, getVendors);
router.post("/vendors", ...premium, createVendor);

router.get("/purchase-orders", auth, getPurchaseOrders);
router.post("/purchase-orders", ...premium, createPurchaseOrder);
router.patch("/purchase-orders/:id/status", ...premium, updatePurchaseOrderStatus);

module.exports = router;
