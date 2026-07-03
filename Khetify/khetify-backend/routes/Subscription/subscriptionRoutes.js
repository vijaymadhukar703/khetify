const express = require("express");
const router = express.Router();
const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const {
  getMySubscription,
  getPlans,
  changePlan,
  getBillingHistory,
} = require("../../controller/Subscription/subscriptionController");

router.get("/plans", getPlans);            // public pricing catalog
router.get("/me", auth, getMySubscription); // drives frontend gating (ALL roles need the plan)
// Billing is owner-only: "billing:manage" resolves only via the company_admin
// wildcard, so operations/sales managers cannot change plans or see invoices.
router.post("/change", auth, authorize("billing:manage"), changePlan);
router.get("/payments", auth, authorize("billing:manage"), getBillingHistory);

module.exports = router;
