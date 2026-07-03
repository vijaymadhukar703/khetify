const { ensureSubscription, effectivePlan, changePlan } = require("../../services/subscriptionService");
const { resolveFeatures, resolveLimits, PLANS } = require("../../config/plans");
const Payment = require("../../model/Payment/Payment");

// Monthly plan prices (₹) used to record a billing row on upgrade.
const PLAN_PRICE = { free: 0, pro: 1499, enterprise: 4999 };

// The company is the subscription owner for all company-side billing flows.
const companyOwner = (req) => ({ ownerType: "company", ownerId: req.user.companyId || req.user.id });

/** GET /api/subscription/me — drives frontend feature gating. */
exports.getMySubscription = async (req, res) => {
  try {
    // companyId, not id: team-member tokens carry the USER id in `id`; the
    // subscription belongs to the COMPANY (legacy owner tokens: id === companyId).
    const sub = await ensureSubscription(companyOwner(req));
    const plan = effectivePlan(sub);
    res.json({
      success: true,
      data: {
        plan,
        status: sub.status,
        features: resolveFeatures(plan),
        limits: resolveLimits(plan),
        currentPeriodEnd: sub.currentPeriodEnd,
      },
    });
  } catch (err) {
    console.error("getMySubscription error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/subscription/plans — public plan catalog for pricing pages. */
exports.getPlans = (req, res) => {
  res.json({ success: true, data: PLANS });
};

/**
 * POST /api/subscription/change  { plan }
 * Dev/manual plan switch. In production this is driven by the payment
 * webhook instead — see subscriptionService.changePlan.
 */
exports.changePlan = async (req, res) => {
  try {
    const { plan } = req.body;
    const sub = await changePlan(companyOwner(req), plan);

    // Record a billing row for paid plans (a real integration does this from
    // the payment-gateway webhook instead).
    if (PLAN_PRICE[plan]) {
      const count = await Payment.countDocuments({ companyId: req.user.companyId || req.user.id });
      await Payment.create({
        companyId: req.user.companyId || req.user.id,
        invoiceNo: `INV-${1001 + count}`,
        plan,
        amount: PLAN_PRICE[plan],
        status: "paid",
      });
    }
    res.json({ success: true, message: `Switched to ${plan}`, data: sub });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/** GET /api/subscription/payments — billing history for this company. */
exports.getBillingHistory = async (req, res) => {
  try {
    const rows = await Payment.find({ companyId: req.user.companyId || req.user.id }).sort({ paidAt: -1 }).limit(100);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getBillingHistory error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
