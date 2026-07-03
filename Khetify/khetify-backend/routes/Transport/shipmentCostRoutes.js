const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Transport/shipmentCostController");

router.get("/analytics/summary", auth, authorize("shipment:read", "report:read"), ctrl.analytics);
router.get("/:shipmentId", auth, authorize("shipment:read"), ctrl.getOne);
router.put("/:shipmentId", auth, authorize("shipment:dispatch"), ctrl.upsert);

module.exports = router;
