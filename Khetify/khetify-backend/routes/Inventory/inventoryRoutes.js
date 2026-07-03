const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");

const {
  getInventory,
  adjustInventory,
  reserveInventory,
  getMovements,
} = require("../../controller/Inventory/inventoryController");

// Free tier
router.get("/", auth, getInventory);
router.post("/adjust", auth, adjustInventory);
router.get("/:productId/movements", auth, getMovements);

// Premium: reserved-stock workflow
router.post(
  "/reserve",
  auth,
  loadSubscription,
  requireFeature(FEATURES.RESERVED_STOCK),
  reserveInventory
);

module.exports = router;
