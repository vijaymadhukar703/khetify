const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");

const {
  createSupplyOrder,
  getSupplyOrders,
  getSourceOptions,
  getPendingCount,
  updateSupplyStatus,
  pickSupplyOrder,
  packSupplyOrder,
  getManifest,
  dispatchSupplyOrder,
  getSupplyOrderDetails,
} = require("../../controller/Supply/supplyController");

// Entire supply workflow is a premium feature.
router.use(auth, loadSubscription, requireFeature(FEATURES.SUPPLY_WORKFLOW));

router.post("/", createSupplyOrder);
router.get("/", getSupplyOrders); // ?stage=pick|pack|dispatch narrows to a Send Stock tab
router.get("/pending-count", getPendingCount); // company Home widget
router.get("/:id/source-options", getSourceOptions); // per-warehouse availability for "Assign a source warehouse"
// READ-ONLY detail: parent lots + the exact child serials picked. Kept off the
// list endpoint so the list stays light; fetched only on View Details.
router.get("/:id/details", getSupplyOrderDetails);
router.put("/:id/status", updateSupplyStatus);
// Direct pick/pack/dispatch on the supply order (no PickList/wave).
router.post("/:id/pick", pickSupplyOrder);
router.post("/:id/pack", packSupplyOrder);
router.get("/:id/manifest", getManifest); // ensure planned shipment + token for the label barcode
router.post("/:id/dispatch", dispatchSupplyOrder);

module.exports = router;
