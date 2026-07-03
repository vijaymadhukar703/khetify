const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Costing/costingController");

router.get("/", auth, authorize("cost:read"), ctrl.list);
router.get("/profitability", auth, authorize("cost:read", "report:read"), ctrl.profitability);
router.get("/valuation", auth, authorize("cost:read", "report:read"), ctrl.valuation);
router.post("/:productId/request", auth, authorize("cost:request"), ctrl.requestChange);
// Approval is owner-only: cost:approve isn't granted to any role except the
// company_admin wildcard (and the service also blocks requester == approver).
router.post("/:productId/approve", auth, authorize("cost:approve"), ctrl.approveChange);

module.exports = router;
