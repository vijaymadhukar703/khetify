const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Seller/sellerTraceController");

// Seller traceability — scan a unit/lot and see its journey. Read-only;
// inventory:read (seller_admin / manager / staff all hold it).
router.use(auth, requireApprovedSeller, authorize("inventory:read"));
router.get("/unit/:serial", ctrl.unit);
router.get("/lot/:lotNumber", ctrl.lot);

module.exports = router;
