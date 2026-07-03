const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
require("../model/Company/Company");
const Seller = require("../model/Seller/Seller");
const User = require("../model/User/User");
const Company = require("../model/Company/Company");
const userCtrl = require("../controller/User/userController");
const companyCtrl = require("../controller/Company/companyController");
const sellerAuth = require("../controller/Seller/sellerAuthController");
const principalRouteGuard = require("../middlewares/principalRouteGuard");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// Shared credentials used across both portals to prove segregation by OWNER,
// not by the credential value.
const PW = "secret123";
let company, companyUser, sellerAccount, sellerMember;

beforeEach(async () => {
  const hash = await bcrypt.hash(PW, 10);

  company = await Company.create({ fullName: "Acme Co", email: "owner@acme.com", number: "9000000001", password: hash, status: "approved" });

  // A COMPANY team member.
  companyUser = await User.create({
    ownerType: "company", companyId: company._id, name: "Coco", email: "coco@acme.com", phone: "9111111111",
    role: "operations_manager", status: "active", passwordHash: hash,
  });

  // A SELLER account (owner) + a SELLER team member, both in their own scope.
  sellerAccount = await Seller.create({ email: "owner@seller.com", phone: "9222222222", passwordHash: hash, status: "active", linkStatus: "approved", sellerInfo: { businessName: "Seed Seller" } });
  sellerMember = await User.create({
    ownerType: "seller", ownerId: sellerAccount._id, name: "Sami", email: "sami@seller.com", phone: "9333333333",
    role: "seller_manager", status: "active", passwordHash: hash,
  });
});

describe("login segregation — seller creds never work on the company portal", () => {
  test("a SELLER member FAILS company team-login (generic Invalid credentials)", async () => {
    const res = mockRes();
    await userCtrl.loginUser({ body: { email: "sami@seller.com", password: PW } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Invalid credentials");
    expect(res.body.token).toBeUndefined();
  });

  test("the SAME seller member SUCCEEDS on seller login", async () => {
    const res = mockRes();
    await sellerAuth.loginSeller({ body: { email: "sami@seller.com", password: PW } }, res);
    expect(res.body.token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.principalType).toBe("seller");
    expect(decoded.role).toBe("seller_manager");
    expect(String(decoded.sellerId)).toBe(String(sellerAccount._id));
  });
});

describe("login segregation — company creds never work on the seller portal", () => {
  test("a COMPANY user FAILS /api/seller/login (generic Invalid credentials)", async () => {
    const res = mockRes();
    await sellerAuth.loginSeller({ body: { email: "coco@acme.com", password: PW } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Invalid credentials");
    expect(res.body.token).toBeUndefined();
  });

  test("the SAME company user SUCCEEDS on company team-login", async () => {
    const res = mockRes();
    await userCtrl.loginUser({ body: { email: "coco@acme.com", password: PW } }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.principalType).toBeUndefined(); // company tokens carry NO principalType
    expect(String(decoded.companyId)).toBe(String(company._id));
  });
});

describe("existing valid logins still work", () => {
  test("the seller ACCOUNT owner logs in via seller login", async () => {
    const res = mockRes();
    await sellerAuth.loginSeller({ body: { email: "owner@seller.com", password: PW } }, res);
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.role).toBe("seller_admin");
    expect(String(decoded.sellerId)).toBe(String(sellerAccount._id));
  });

  test("the company OWNER logs in via company login (Company collection only)", async () => {
    const res = mockRes();
    await companyCtrl.loginCompany({ body: { email: "owner@acme.com", password: PW } }, res);
    expect(res.body.token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(String(decoded.companyId)).toBe(String(company._id));
    // a seller cannot authenticate here — it isn't in the Company collection
    const denied = mockRes();
    await companyCtrl.loginCompany({ body: { email: "owner@seller.com", password: PW } }, denied);
    expect(denied.statusCode).toBe(400);
  });
});

describe("principalRouteGuard — token/route integrity (defence in depth)", () => {
  const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET);
  const run = (token, path) => {
    let nexted = false;
    const req = { path, headers: token ? { authorization: `Bearer ${token}` } : {} };
    const res = mockRes();
    principalRouteGuard(req, res, () => { nexted = true; });
    return { nexted, code: res.statusCode, body: res.body };
  };

  test("a SELLER token is rejected on a company-only route", () => {
    const t = sign({ id: "x", sellerId: "s", principalType: "seller", role: "seller_admin" });
    const r = run(t, "/api/users");
    expect(r.nexted).toBe(false);
    expect(r.code).toBe(403);
    expect(r.body.message).toBe("Company access only");
  });

  test("a COMPANY token is rejected on /api/seller/*", () => {
    const t = sign({ id: "c", companyId: "c", role: "company_admin" });
    const r = run(t, "/api/seller/warehouses");
    expect(r.nexted).toBe(false);
    expect(r.code).toBe(403);
    expect(r.body.message).toBe("Seller access only");
  });

  test("each principal passes on its OWN side", () => {
    const sellerT = sign({ id: "x", sellerId: "s", principalType: "seller", role: "seller_admin" });
    const companyT = sign({ id: "c", companyId: "c", role: "company_admin" });
    expect(run(sellerT, "/api/seller/transfers").nexted).toBe(true);
    expect(run(companyT, "/api/inventory").nexted).toBe(true);
  });

  test("public/tokenless and non-API requests pass through untouched", () => {
    expect(run(null, "/api/seller/login").nexted).toBe(true); // no token → login can run
    expect(run(null, "/api/company/login").nexted).toBe(true);
    expect(run("not-a-jwt", "/api/users").nexted).toBe(true); // bad token → inner auth 401s
    expect(run(null, "/uploads/x.pdf").nexted).toBe(true); // non-API
  });
});
