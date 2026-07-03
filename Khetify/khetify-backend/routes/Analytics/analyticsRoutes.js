const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");

const { getOverview } = require("../../controller/Analytics/analyticsController");

// Premium: advanced analytics & reporting.
router.get("/overview", auth, loadSubscription, requireFeature(FEATURES.ADVANCED_ANALYTICS), getOverview);

module.exports = router;
