const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");
const { getSellerLots } = require("../../controller/Seller/sellerInventoryController");

// Read-only seller inventory (lots / stock / batches) — a PAID feature
// (INVENTORY_VIEW). Free sellers can still receive (inbound) and sell (outbound)
// via their own routes; they just can't open the inventory views.
router.use(auth, requireApprovedSeller, loadSubscription, requireFeature(FEATURES.INVENTORY_VIEW));
router.get("/", getSellerLots);

module.exports = router;
