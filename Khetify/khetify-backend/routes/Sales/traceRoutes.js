const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Sales/traceController");

// Readable by warehouse/sales roles (inventory:read) AND auditors (report:read).
const canTrace = authorize("inventory:read", "report:read");

router.get("/serial/:serial", auth, canTrace, ctrl.serial);
router.get("/lot/:lotNumber", auth, canTrace, ctrl.lot);
router.get("/invoice/:invoiceNumber", auth, canTrace, ctrl.invoice);

module.exports = router;
