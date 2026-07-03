const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Seller = require("../model/Seller/Seller");
const Subscription = require("../model/Company/Subscription/Subscription");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const ctrl = require("../controller/Seller/sellerCompanyController");

// A company the seller is already ENGAGED with (active PC) is excluded.
async function mintPc(sellerId, companyId) {
  const until = new Date(); until.setFullYear(until.getFullYear() + 1);
  await PrincipalCertificate.create({
    pcNumber: `KH-PC-${String(companyId).slice(-4)}-${Date.now()}-${Math.round(Math.random() * 1e6)}`, sellerId, companyId,
    validFrom: new Date(), validUntil: until, status: "active",
    govt: { required: false, status: "not_required" }, issuedAt: new Date(),
  });
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const company = (name, extra = {}) => Company.create({
  fullName: name, email: `${name.replace(/\s/g, "").toLowerCase()}-${new mongoose.Types.ObjectId()}@x.com`,
  password: "x", status: "approved", companyInfo: { companyName: name }, ...extra,
});

let sellerId;
beforeEach(async () => {
  sellerId = (await Seller.create({ email: `s-${new mongoose.Types.ObjectId()}@x.com`, passwordHash: "x", status: "active", linkStatus: "approved", sellerInfo: { businessName: "S" } }))._id;
});

describe("recommended companies — IMS-subscribed ranked first", () => {
  test("subscribed companies surface before free ones; linked ones are excluded", async () => {
    const free = await company("Zeta Free");                                 // no subscription
    const pro = await company("Bravo Agri");                                 // active Pro sub
    const legacyPaid = await company("Alpha Seeds", { subscription: "paid" }); // legacy paid flag
    const linked = await company("Linked Co");                               // already PC-engaged → excluded

    await Subscription.create({ ownerType: "company", ownerId: pro._id, companyId: pro._id, plan: "pro", status: "active" });
    await mintPc(sellerId, linked._id);

    const res = mockRes();
    await ctrl.getRecommendedCompanies({ user: { sellerId } }, res);
    expect(res.body.success).toBe(true);

    const names = res.body.data.map((d) => d.businessName);
    expect(names).not.toContain("Linked Co");                  // excluded
    // both subscribed companies rank ahead of the free one (alpha order within tier)
    expect(names).toEqual(["Alpha Seeds", "Bravo Agri", "Zeta Free"]);

    const byName = Object.fromEntries(res.body.data.map((d) => [d.businessName, d]));
    expect(byName["Alpha Seeds"].subscribed).toBe(true);   // legacy paid
    expect(byName["Bravo Agri"].subscribed).toBe(true);    // active Pro sub
    expect(byName["Zeta Free"].subscribed).toBe(false);
    expect(String(free._id)).toBeTruthy();
  });

  test("an expired/canceled sub is NOT treated as subscribed", async () => {
    const c = await company("Past Due Co");
    await Subscription.create({ ownerType: "company", ownerId: c._id, companyId: c._id, plan: "pro", status: "canceled" });
    const res = mockRes();
    await ctrl.getRecommendedCompanies({ user: { sellerId } }, res);
    const row = res.body.data.find((d) => d.businessName === "Past Due Co");
    expect(row.subscribed).toBe(false);
    expect(row.plan).toBe("free");
  });
});
