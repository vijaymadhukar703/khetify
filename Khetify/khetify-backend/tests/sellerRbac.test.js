const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
require("../model/Company/Company");
const Seller = require("../model/Seller/Seller");
const User = require("../model/User/User");
const { hasCapability } = require("../config/permissions");
const authorize = require("../middlewares/authorize");
const sellerTeam = require("../controller/Seller/sellerTeamController");
const sellerAuth = require("../controller/Seller/sellerAuthController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const sReq = (sellerId, { body = {}, params = {} } = {}) => ({ user: { sellerId, id: sellerId, principalType: "seller", role: "seller_admin" }, body, params });

let sellerA, sellerB;
beforeEach(async () => {
  sellerA = (await Seller.create({ passwordHash: await bcrypt.hash("ownerpass", 10), email: `a-${new mongoose.Types.ObjectId()}@x.com`, sellerInfo: { businessName: "A" }, status: "active", linkStatus: "approved" }))._id;
  sellerB = (await Seller.create({ passwordHash: "x", email: `b-${new mongoose.Types.ObjectId()}@x.com`, sellerInfo: { businessName: "B" }, status: "active", linkStatus: "approved" }))._id;
});

describe("seller capability engine (reuses config/permissions)", () => {
  test("seller_admin full; seller_manager manages; seller_staff read-mostly", () => {
    expect(hasCapability("seller_admin", "warehouse:manage")).toBe(true);
    expect(hasCapability("seller_admin", "user:manage")).toBe(true);

    expect(hasCapability("seller_manager", "warehouse:manage")).toBe(true);
    expect(hasCapability("seller_manager", "order:create")).toBe(true);
    expect(hasCapability("seller_manager", "user:manage")).toBe(false); // not the team

    expect(hasCapability("seller_staff", "warehouse:read")).toBe(true);
    expect(hasCapability("seller_staff", "inventory:read")).toBe(true);
    expect(hasCapability("seller_staff", "order:create")).toBe(true);
    expect(hasCapability("seller_staff", "warehouse:manage")).toBe(false); // write blocked
    expect(hasCapability("seller_staff", "customer:update")).toBe(false);
    expect(hasCapability("seller_staff", "user:manage")).toBe(false);
  });

  test("authorize() middleware blocks staff writes, allows reads", () => {
    const run = (role, cap) => { let n = false; const res = mockRes(); authorize(cap)({ user: { role } }, res, () => { n = true; }); return { n, code: res.statusCode }; };
    expect(run("seller_staff", "warehouse:manage").code).toBe(403);
    expect(run("seller_staff", "warehouse:read").n).toBe(true);
    expect(run("seller_admin", "warehouse:manage").n).toBe(true);
    expect(run("seller_manager", "warehouse:manage").n).toBe(true);
  });

  test("company RBAC is unchanged", () => {
    expect(hasCapability("company_admin", "user:manage")).toBe(true);
    expect(hasCapability("company_admin", "inventory:transfer")).toBe(false); // still denied
    expect(hasCapability("operations_manager", "inventory:transfer")).toBe(true);
  });
});

describe("seller team CRUD is seller-scoped", () => {
  test("create → list (own only) → another seller can't see/manage it", async () => {
    const created = mockRes();
    await sellerTeam.createMember(sReq(sellerA, { body: { name: "Ravi", email: "ravi@x.com", role: "seller_staff", password: "p" } }), created);
    expect(created.statusCode).toBe(201);
    const memberId = created.body.data._id;
    expect(created.body.data.ownerType).toBe("seller");
    expect(String(created.body.data.ownerId)).toBe(String(sellerA));

    const listA = mockRes();
    await sellerTeam.getTeam(sReq(sellerA), listA);
    expect(listA.body.data.some((m) => String(m._id) === String(memberId))).toBe(true);

    const listB = mockRes();
    await sellerTeam.getTeam(sReq(sellerB), listB);
    expect(listB.body.data.some((m) => String(m._id) === String(memberId))).toBe(false);

    // seller B cannot update seller A's member
    const denied = mockRes();
    await sellerTeam.updateMember(sReq(sellerB, { params: { id: memberId }, body: { status: "disabled" } }), denied);
    expect(denied.statusCode).toBe(404);
  });

  test("rejects a non-seller (company) role", async () => {
    const res = mockRes();
    await sellerTeam.createMember(sReq(sellerA, { body: { name: "X", role: "operations_manager", password: "p" } }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe("seller team member login issues a seller-scoped token", () => {
  test("member logs in via seller login → token carries their role + the seller account id", async () => {
    await User.create({ ownerType: "seller", ownerId: sellerA, name: "Ravi", email: "ravi2@x.com", role: "seller_staff", status: "active", passwordHash: await bcrypt.hash("staffpass", 10) });
    const res = mockRes();
    await sellerAuth.loginSeller({ body: { email: "ravi2@x.com", password: "staffpass" } }, res);
    expect(res.body.token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.principalType).toBe("seller");
    expect(decoded.role).toBe("seller_staff");
    expect(String(decoded.sellerId)).toBe(String(sellerA)); // scoped to the seller ACCOUNT
    expect(res.body.member.role).toBe("seller_staff");
  });

  test("the account owner still logs in as seller_admin", async () => {
    const res = mockRes();
    await sellerAuth.loginSeller({ body: { email: (await Seller.findById(sellerA)).email, password: "ownerpass" } }, res);
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.role).toBe("seller_admin");
    expect(String(decoded.sellerId)).toBe(String(sellerA));
  });
});
