const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Analytics/ownerController");

// Executive view — company owners (company_admin holds "*") and auditors.
// Consolidated role structure: operations/sales managers use their own
// dashboards (/ims, /ims/analytics) instead.
router.get("/dashboard", auth, authorize("executive:view"), ctrl.dashboard);

module.exports = router;
