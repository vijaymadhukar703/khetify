const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Seller/sellerSubscriptionController");

// Seller subscription/billing. Auth only (NOT requireApprovedSeller — a seller
// must be able to see/upgrade their plan regardless of company-link status).
// READS (/me, /plans) stay open to every seller principal — managers/staff need
// /me so their IMS gating reflects the OWNER's plan. CHANGING the plan is a
// billing action: seller_admin only (billing:manage; held via "*").
router.use(auth);
router.get("/me", ctrl.getMySubscription);
router.get("/plans", ctrl.getPlans);
router.post("/change", authorize("billing:manage"), ctrl.changePlan);

module.exports = router;
