const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const loadSubscription = require("../../middlewares/loadSubscription");
const ctrl = require("../../controller/Analytics/reportController");

router.get("/", auth, authorize("report:read"), ctrl.list);
router.get("/dashboard", auth, authorize("report:read"), ctrl.dashboard);
// loadSubscription so the controller can enforce ADVANCED_ANALYTICS per report.
router.get("/:name", auth, authorize("report:read"), loadSubscription, ctrl.run);

module.exports = router;
