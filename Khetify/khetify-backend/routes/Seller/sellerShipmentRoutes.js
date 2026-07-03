const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Seller/sellerShipmentController");

// Seller shipments (supply + inter-warehouse transfers). Approved sellers only.
// Reads need transfer:read; dispatch + scan-receive need transfer:create
// (seller_admin "*" / seller_manager "transfer:*").
router.use(auth, requireApprovedSeller);
router.get("/", authorize("transfer:read"), ctrl.list);
router.get("/:id", authorize("transfer:read"), ctrl.get);
router.post("/:id/pick", authorize("transfer:create"), ctrl.pick); // scan-to-pick (Send Stock)
router.post("/:id/pack", authorize("transfer:create"), ctrl.pack); // pack a fully-picked shipment
router.get("/:id/manifest", authorize("transfer:create"), ctrl.manifest); // print label before dispatch
router.post("/:id/dispatch", authorize("transfer:create"), ctrl.dispatch);
router.post("/:id/receive", authorize("transfer:create"), ctrl.receive);

module.exports = router;
