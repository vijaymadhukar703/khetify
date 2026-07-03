const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Company = require("../model/Company/Company");
const companyCtrl = require("../controller/Company/companyController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const sha256 = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

describe("forgotPassword", () => {
  test("rejects a missing/invalid email", async () => {
    for (const email of ["", "   ", "not-an-email"]) {
      const res = mockRes();
      await companyCtrl.forgotPassword({ body: { email } }, res);
      expect(res.statusCode).toBe(400);
    }
  });

  test("unknown email returns the generic 200 and sets no token", async () => {
    const res = mockRes();
    await companyCtrl.forgotPassword({ body: { email: "nobody@x.com" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toMatch(/reset link/i);
    const any = await Company.findOne({ email: "nobody@x.com" });
    expect(any).toBeNull();
  });

  test("known email issues a hashed token with an expiry", async () => {
    const c = await Company.create({ fullName: "Reset Co", email: "reset@x.com", password: await bcrypt.hash("secret123", 10) });
    const res = mockRes();
    await companyCtrl.forgotPassword({ body: { email: "reset@x.com" } }, res);
    expect(res.statusCode).toBe(200);
    const saved = await Company.findById(c._id).select("resetPasswordToken resetPasswordExpires");
    expect(saved.resetPasswordToken).toBeTruthy();
    expect(saved.resetPasswordExpires.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("resetPassword", () => {
  test("rejects a short password or missing token", async () => {
    const noToken = mockRes();
    await companyCtrl.resetPassword({ body: { password: "longenough" } }, noToken);
    expect(noToken.statusCode).toBe(400);

    const shortPw = mockRes();
    await companyCtrl.resetPassword({ body: { token: "abc", password: "123" } }, shortPw);
    expect(shortPw.statusCode).toBe(400);
  });

  test("rejects an expired token", async () => {
    const raw = crypto.randomBytes(16).toString("hex");
    await Company.create({
      fullName: "Expired Co", email: "expired@x.com", password: "x",
      resetPasswordToken: sha256(raw), resetPasswordExpires: new Date(Date.now() - 1000),
    });
    const res = mockRes();
    await companyCtrl.resetPassword({ body: { token: raw, password: "newpass123" } }, res);
    expect(res.statusCode).toBe(400);
  });

  test("a valid token sets the new password and clears the token", async () => {
    const raw = crypto.randomBytes(16).toString("hex");
    const c = await Company.create({
      fullName: "Valid Co", email: "valid@x.com", password: await bcrypt.hash("oldpass123", 10),
      resetPasswordToken: sha256(raw), resetPasswordExpires: new Date(Date.now() + 60000),
    });
    const res = mockRes();
    await companyCtrl.resetPassword({ body: { token: raw, password: "newpass123" } }, res);
    expect(res.statusCode).toBe(200);

    const saved = await Company.findById(c._id).select("password resetPasswordToken resetPasswordExpires");
    expect(saved.resetPasswordToken).toBeNull();
    expect(saved.resetPasswordExpires).toBeNull();
    expect(await bcrypt.compare("newpass123", saved.password)).toBe(true);
    // the same token cannot be reused
    const reuse = mockRes();
    await companyCtrl.resetPassword({ body: { token: raw, password: "another123" } }, reuse);
    expect(reuse.statusCode).toBe(400);
  });
});
