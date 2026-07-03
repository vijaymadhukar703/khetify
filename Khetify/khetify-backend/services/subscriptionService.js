const Subscription = require("../model/Company/Subscription/Subscription");
const Company = require("../model/Company/Company");
const {
  resolveFeatures, resolveLimits, resolveSellerFeatures, resolveSellerLimits, PLANS, SELLER_PLANS,
} = require("../config/plans");

/** Accept an owner object { ownerType, ownerId } OR a bare companyId (legacy →
 * company owner), so existing company callers keep working unchanged. */
function normalizeOwner(owner) {
  if (owner && typeof owner === "object" && owner.ownerType) {
    return { ownerType: owner.ownerType, ownerId: owner.ownerId };
  }
  return { ownerType: "company", ownerId: owner };
}

/** Derive the subscription owner from req.user (seller principal vs company). */
function ownerFromUser(user) {
  if (user && user.principalType === "seller" && user.sellerId) {
    return { ownerType: "seller", ownerId: user.sellerId };
  }
  return { ownerType: "company", ownerId: user && (user.companyId || user.id) };
}

/** Plan catalog + resolvers for an owner type. */
function plansFor(ownerType) {
  return ownerType === "seller"
    ? { PLANS: SELLER_PLANS, features: resolveSellerFeatures, limits: resolveSellerLimits }
    : { PLANS, features: resolveFeatures, limits: resolveLimits };
}

/**
 * Get the owner's subscription, creating a default "free" one if missing.
 * Keeps the denormalized features/limits in sync with config/plans.js.
 */
async function ensureSubscription(owner) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const cfg = plansFor(ownerType);

  let sub = await Subscription.findOne({ ownerType, ownerId });

  // Backward compatibility: a company subscription created before owner fields
  // existed is keyed only by companyId — adopt it and backfill the owner.
  if (!sub && ownerType === "company") {
    sub = await Subscription.findOne({ companyId: ownerId, ownerType: { $exists: false } });
    if (sub) {
      sub.ownerType = "company";
      sub.ownerId = ownerId;
      await sub.save();
    }
  }

  if (!sub) {
    let plan = "free";
    if (ownerType === "company") {
      const company = await Company.findById(ownerId).select("subscription");
      plan = company && company.subscription === "paid" ? "pro" : "free";
    }
    sub = await Subscription.create({
      ownerType,
      ownerId,
      companyId: ownerType === "company" ? ownerId : undefined,
      plan,
      features: cfg.features(plan),
      limits: cfg.limits(plan),
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
  }

  return sub;
}

/** Effective plan = subscribed plan if active & not expired, else "free". */
function effectivePlan(sub) {
  const active =
    sub.status === "active" &&
    (!sub.currentPeriodEnd || sub.currentPeriodEnd > new Date());
  return active ? sub.plan : "free";
}

/** Resolve the feature list for a subscription, honoring its owner type. */
function featuresForSub(sub) {
  const cfg = plansFor(sub.ownerType || "company");
  return cfg.features(effectivePlan(sub));
}

/** Change an owner's plan and refresh denormalized features/limits. */
async function changePlan(owner, plan) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const cfg = plansFor(ownerType);
  if (!cfg.PLANS[plan]) throw new Error("Invalid plan");

  const sub = await ensureSubscription({ ownerType, ownerId });
  sub.plan = plan;
  sub.status = "active";
  sub.features = cfg.features(plan);
  sub.limits = cfg.limits(plan);
  sub.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await sub.save();

  // Keep the legacy Company.subscription flag mirrored (company only).
  if (ownerType === "company") {
    await Company.findByIdAndUpdate(ownerId, { subscription: plan === "free" ? "free" : "paid" });
  }

  return sub;
}

module.exports = { ensureSubscription, effectivePlan, changePlan, ownerFromUser, normalizeOwner, featuresForSub, plansFor };
