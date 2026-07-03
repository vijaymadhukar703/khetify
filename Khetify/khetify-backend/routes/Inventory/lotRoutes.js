const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");
const { sellFefoBody, receiveBody, transferBody } = require("../../validators/lotValidators");

const {
  getLots,
  receiveLot,
  transferLot,
  sellFefo,
} = require("../../controller/Inventory/lotController");

// Reading lots: any logged-in company / inventory-reading role.
router.get("/", auth, authorize("lot:read"), getLots);

// FEFO selling deducts stock — sales-capable roles only.
router.post("/sell-fefo", auth, authorize("order:create"), validate({ body: sellFefoBody }), sellFefo);

// Premium: batch & expiry tracking (matches plans.js FEATURES).
router.post(
  "/receive",
  auth,
  authorize("lot:receive"),
  loadSubscription,
  requireFeature(FEATURES.BATCH_EXPIRY),
  validate({ body: receiveBody }),
  receiveLot
);

// Premium: cross-warehouse movement.
router.post(
  "/transfer",
  auth,
  authorize("inventory:transfer"),
  loadSubscription,
  requireFeature(FEATURES.MULTI_WAREHOUSE),
  validate({ body: transferBody }),
  transferLot
);

module.exports = router;
