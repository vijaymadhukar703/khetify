const jwt = require("jsonwebtoken");
const Seller = require("../model/Seller/Seller");
const authMiddleware = require("../middlewares/authMiddlewares");
const sellerAuth = require("../controller/Seller/sellerAuthController");

/** Minimal express-style req/res mocks. */
function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
function runAuth(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  let nextCalled = false;
  const res = mockRes();
  authMiddleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

describe("authMiddleware principal resolution", () => {
  test("a seller token resolves sellerId + principalType:'seller' (no companyId)", () => {
    const sellerId = "650000000000000000000001";
    const token = jwt.sign(
      { id: sellerId, sellerId, principalType: "seller", role: "seller_admin" },
      process.env.JWT_SECRET,
    );
    const { req, nextCalled } = runAuth(token);
    expect(nextCalled).toBe(true);
    expect(req.user.sellerId).toBe(sellerId);
    expect(req.user.principalType).toBe("seller");
    expect(req.user.role).toBe("seller_admin");
    expect(req.user.companyId).toBeUndefined(); // a seller never leaks into company scope
  });

  test("a company token still resolves companyId unchanged (backwards compatible)", () => {
    const companyId = "650000000000000000000002";
    const token = jwt.sign({ id: companyId, companyId, role: "company_admin" }, process.env.JWT_SECRET);
    const { req } = runAuth(token);
    expect(req.user.companyId).toBe(companyId);
    expect(req.user.principalType).toBe("company");
    expect(req.user.role).toBe("company_admin");
    expect(req.user.sellerId).toBeUndefined();
  });

  test("a legacy company token ({ id } only) keeps companyId === id", () => {
    const id = "650000000000000000000003";
    const token = jwt.sign({ id }, process.env.JWT_SECRET);
    const { req } = runAuth(token);
    expect(req.user.companyId).toBe(id);
    expect(req.user.principalType).toBe("company");
    expect(req.user.role).toBe("company_admin");
  });
});

describe("seller register / login", () => {
  test("registerSeller creates a pending seller and returns a token", async () => {
    const res = mockRes();
    await sellerAuth.registerSeller(
      { body: { businessName: "Krishna Distributors", email: "Krishna@x.com", phone: "9990001111", password: "secret123" } },
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.seller.status).toBe("pending");
    expect(res.body.seller.email).toBe("krishna@x.com"); // normalised lowercase
    expect(res.body.seller.passwordHash).toBeUndefined(); // never returned

    // the token is a valid seller principal
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.principalType).toBe("seller");
    expect(String(decoded.sellerId)).toBe(String(res.body.seller._id));

    // it is persisted, hashed
    const saved = await Seller.findById(res.body.seller._id);
    expect(saved.status).toBe("pending");
    expect(saved.passwordHash).not.toBe("secret123");
  });

  test("registerSeller rejects a duplicate email", async () => {
    await sellerAuth.registerSeller(
      { body: { businessName: "Dup Co", email: "dup@x.com", phone: "9990002222", password: "secret123" } },
      mockRes(),
    );
    const res = mockRes();
    await sellerAuth.registerSeller({ body: { businessName: "Dup Co 2", email: "dup@x.com", phone: "9990003333", password: "secret123" } }, res);
    expect(res.statusCode).toBe(400);
  });

  test("registerSeller rejects payloads missing any required field", async () => {
    const base = { businessName: "Req Co", email: "req@x.com", phone: "9991110000", password: "secret123" };
    for (const drop of ["businessName", "email", "phone", "password"]) {
      const body = { ...base };
      delete body[drop];
      const res = mockRes();
      await sellerAuth.registerSeller({ body }, res);
      expect(res.statusCode).toBe(400); // missing ${drop}
    }
    // also: malformed email, short phone, short password
    for (const bad of [
      { ...base, email: "not-an-email" },
      { ...base, phone: "12345" },
      { ...base, password: "123" },
    ]) {
      const res = mockRes();
      await sellerAuth.registerSeller({ body: bad }, res);
      expect(res.statusCode).toBe(400);
    }
  });

  test("loginSeller returns a token for valid credentials and 400 for bad ones", async () => {
    await sellerAuth.registerSeller(
      { body: { businessName: "Login Co", email: "login@x.com", phone: "9990004444", password: "secret123" } },
      mockRes(),
    );

    const ok = mockRes();
    await sellerAuth.loginSeller({ body: { email: "login@x.com", password: "secret123" } }, ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.seller.passwordHash).toBeUndefined();

    const bad = mockRes();
    await sellerAuth.loginSeller({ body: { email: "login@x.com", password: "wrong" } }, bad);
    expect(bad.statusCode).toBe(400);
  });

  test("getSellerMe returns the scoped seller with seller_admin capabilities", async () => {
    const reg = mockRes();
    await sellerAuth.registerSeller({ body: { businessName: "Me Co", email: "me@x.com", phone: "9990005555", password: "secret123" } }, reg);
    const sellerId = reg.body.seller._id;

    const res = mockRes();
    await sellerAuth.getSellerMe({ user: { sellerId, role: "seller_admin" } }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.principalType).toBe("seller");
    expect(res.body.data.capabilities).toContain("*");
    expect(String(res.body.data._id)).toBe(String(sellerId));
  });
});

describe("seller onboarding steps require every field", () => {
  let sellerId;
  beforeEach(async () => {
    const reg = mockRes();
    await sellerAuth.registerSeller({ body: { businessName: "Onb Co", email: "onb@x.com", phone: "9990006666", password: "secret123" } }, reg);
    sellerId = reg.body.seller._id;
  });
  const asSeller = (body) => ({ user: { sellerId, role: "seller_admin" }, body });

  test("info step: rejects missing fields, accepts a complete payload", async () => {
    const bad = mockRes();
    await sellerAuth.updateSellerInfo(asSeller({ businessName: "", businessType: "Distributor", productCategories: ["Seeds"], yearStarted: "2018" }), bad);
    expect(bad.statusCode).toBe(400);

    const noCat = mockRes();
    await sellerAuth.updateSellerInfo(asSeller({ businessName: "Onb Co", businessType: "Distributor", productCategories: [], yearStarted: "2018" }), noCat);
    expect(noCat.statusCode).toBe(400);

    const badYear = mockRes();
    await sellerAuth.updateSellerInfo(asSeller({ businessName: "Onb Co", businessType: "Distributor", productCategories: ["Seeds"], yearStarted: "abcd" }), badYear);
    expect(badYear.statusCode).toBe(400);

    const ok = mockRes();
    await sellerAuth.updateSellerInfo(asSeller({ businessName: "Onb Co", businessType: "Distributor", productCategories: ["Seeds"], yearStarted: "2018" }), ok);
    expect(ok.body.success).toBe(true);
  });

  test("contact step: rejects bad pincode/email/phone, accepts a complete payload", async () => {
    const full = { address: { line: "1 Main Rd", city: "Indore", state: "MP", pincode: "452001" }, ownerName: "Raj", officialEmail: "raj@x.com", officialPhone: "9876543210" };

    const badPin = mockRes();
    await sellerAuth.updateSellerContact(asSeller({ ...full, address: { ...full.address, pincode: "12" } }), badPin);
    expect(badPin.statusCode).toBe(400);

    const badEmail = mockRes();
    await sellerAuth.updateSellerContact(asSeller({ ...full, officialEmail: "nope" }), badEmail);
    expect(badEmail.statusCode).toBe(400);

    const missingCity = mockRes();
    await sellerAuth.updateSellerContact(asSeller({ ...full, address: { ...full.address, city: "" } }), missingCity);
    expect(missingCity.statusCode).toBe(400);

    const ok = mockRes();
    await sellerAuth.updateSellerContact(asSeller(full), ok);
    expect(ok.body.success).toBe(true);
  });

  test("verification step: requires GSTIN/PAN/Udyam", async () => {
    const bad = mockRes();
    await sellerAuth.updateSellerVerification(asSeller({ gstin: "", pan: "ABCDE1234F", udyam: "UDY-1" }), bad);
    expect(bad.statusCode).toBe(400);

    const ok = mockRes();
    await sellerAuth.updateSellerVerification(asSeller({ gstin: "22AAAAA0000A1Z5", pan: "ABCDE1234F", udyam: "UDY-1" }), ok);
    expect(ok.body.success).toBe(true);
  });
});
