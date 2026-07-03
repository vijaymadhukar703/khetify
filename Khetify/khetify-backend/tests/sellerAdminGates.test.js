const mongoose = require("mongoose");
require("../model/Company/Company");
const Seller = require("../model/Seller/Seller");
const Subscription = require("../model/Company/Subscription/Subscription");
const { hasCapability } = require("../config/permissions");
const authorize = require("../middlewares/authorize");
const loadSubscription = require("../middlewares/loadSubscription");
const requireFeature = require("../middlewares/requireFeature");
const { FEATURES } = require("../config/plans");
const { changePlan } = require("../services/subscriptionService");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
// Run a middleware against a principal and report whether it called next().
const runMw = (mw, user) => new Promise((resolve) => {
  const res = mockRes();
  let nexted = false;
  const ret = mw({ user }, res, () => { nexted = true; resolve({ nexted, code: 200 }); });
  // authorize() is sync and returns after res when blocked
  if (ret instanceof Promise) ret.then(() => resolve({ nexted, code: res.statusCode }));
  else if (!nexted) resolve({ nexted, code: res.statusCode });
});

const admin = (sellerId) => ({ id: sellerId, sellerId, principalType: "seller", role: "seller_admin" });
const manager = (sellerId) => ({ id: new mongoose.Types.ObjectId(), sellerId, principalType: "seller", role: "seller_manager" });
const staff = (sellerId) => ({ id: new mongoose.Types.ObjectId(), sellerId, principalType: "seller", role: "seller_staff" });

let sellerId;
beforeEach(async () => {
  sellerId = (await Seller.create({ email: `s-${new mongoose.Types.ObjectId()}@x.com`, passwordHash: "x", status: "active", linkStatus: "approved", sellerInfo: { businessName: "S" } }))._id;
});

describe("Part 3 — admin-only capabilities", () => {
  test("billing/company/certification:manage held by seller_admin ONLY", () => {
    for (const cap of ["billing:manage", "company:manage", "certification:manage"]) {
      expect(hasCapability("seller_admin", cap)).toBe(true);
      expect(hasCapability("seller_manager", cap)).toBe(false);
      expect(hasCapability("seller_staff", cap)).toBe(false);
    }
  });

  test("a manager/staff keeps their operational caps (no regression)", () => {
    expect(hasCapability("seller_manager", "warehouse:manage")).toBe(true);
    expect(hasCapability("seller_manager", "transfer:create")).toBe(true);
    expect(hasCapability("seller_staff", "inventory:read")).toBe(true);
    expect(hasCapability("seller_staff", "order:create")).toBe(true);
  });
});

describe("Part 3 — endpoint guards (authorize) block non-admins", () => {
  test("billing change requires billing:manage", async () => {
    expect((await runMw(authorize("billing:manage"), manager(sellerId))).code).toBe(403);
    expect((await runMw(authorize("billing:manage"), staff(sellerId))).code).toBe(403);
    expect((await runMw(authorize("billing:manage"), admin(sellerId))).nexted).toBe(true);
  });

  test("companies search/apply require company:manage", async () => {
    expect((await runMw(authorize("company:manage"), manager(sellerId))).code).toBe(403);
    expect((await runMw(authorize("company:manage"), admin(sellerId))).nexted).toBe(true);
  });

  test("certifications require certification:manage", async () => {
    expect((await runMw(authorize("certification:manage"), manager(sellerId))).code).toBe(403);
    expect((await runMw(authorize("certification:manage"), staff(sellerId))).code).toBe(403);
    expect((await runMw(authorize("certification:manage"), admin(sellerId))).nexted).toBe(true);
  });
});

describe("Part 4 — paid IMS follows the OWNER seller's subscription", () => {
  test("a manager resolves the OWNER's subscription (loadSubscription by sellerId)", async () => {
    const res = mockRes();
    const req = { user: manager(sellerId) };
    await loadSubscription(req, res, () => {});
    expect(req.subscription).toBeTruthy();
    expect(req.subscription.ownerType).toBe("seller");
    expect(String(req.subscription.ownerId)).toBe(String(sellerId));
  });

  test("owner FREE → manager is blocked from the paid Inventory feature (403)", async () => {
    const req = { user: manager(sellerId) };
    await loadSubscription(req, mockRes(), () => {});
    const gate = requireFeature(FEATURES.INVENTORY_VIEW);
    const res = mockRes();
    let nexted = false;
    gate(req, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("UPGRADE_REQUIRED");
  });

  test("owner PRO → the SAME manager gets the paid Inventory feature (no own plan)", async () => {
    await changePlan({ ownerType: "seller", ownerId: sellerId }, "pro"); // admin subscribes the owner
    const req = { user: manager(sellerId) };           // member never has their own plan
    await loadSubscription(req, mockRes(), () => {});
    const gate = requireFeature(FEATURES.INVENTORY_VIEW);
    let nexted = false;
    const res = mockRes();
    gate(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    // confirm there is exactly ONE subscription — the owner's
    const subs = await Subscription.find({ ownerType: "seller", ownerId: sellerId });
    expect(subs).toHaveLength(1);
  });
});
