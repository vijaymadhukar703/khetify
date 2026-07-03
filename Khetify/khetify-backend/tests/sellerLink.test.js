const mongoose = require("mongoose");
const Seller = require("../model/Seller/Seller");
const Company = require("../model/Company/Company");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const pcService = require("../services/pcService");
const companySellers = require("../controller/Company/companySellerController");
const requireApprovedSeller = require("../middlewares/requireApprovedSeller");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// Mint an ACTIVE PC (the new authorization) for a (seller, company) pair.
async function mintPc(sellerId, companyId) {
  const until = new Date(); until.setFullYear(until.getFullYear() + 1);
  await PrincipalCertificate.create({
    pcNumber: `KH-PC-${String(companyId).slice(-4)}-${Date.now()}`, sellerId, companyId,
    validFrom: new Date(), validUntil: until, status: "active",
    govt: { required: false, status: "not_required" }, issuedAt: new Date(),
  });
  await pcService.reconcileLink(sellerId, companyId);
}

let company, otherCompany, sellerId;

beforeEach(async () => {
  company = await Company.create({ fullName: "Supplier Co", email: `s-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: "Supplier Co" } });
  otherCompany = await Company.create({ fullName: "Other Co", email: `o-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved" });
  const s = await Seller.create({ passwordHash: "x", status: "pending", linkStatus: "unlinked", sellerInfo: { businessName: "Krishna Distributors" } });
  sellerId = s._id;
});

describe("authorization is now PC issuance (no separate link approval)", () => {
  test("a fresh seller is unlinked", async () => {
    expect((await Seller.findById(sellerId)).linkStatus).toBe("unlinked");
  });

  test("issuing a PC reconciles the seller to approved (PC is the source of truth)", async () => {
    await mintPc(sellerId, company._id);
    const s = await Seller.findById(sellerId);
    expect(s.linkStatus).toBe("approved");
    expect(s.status).toBe("active");
    expect(await pcService.hasActivePc(sellerId, company._id)).toBe(true);
  });
});

describe("company Sellers list shows PC-issued resellers", () => {
  test("lists only this company's active-PC sellers", async () => {
    await mintPc(sellerId, company._id);
    const res = mockRes();
    await companySellers.listSellers({ user: { companyId: company._id }, query: {} }, res);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].businessName).toBe("Krishna Distributors");
    expect(res.body.data[0].pcNumber).toBeTruthy();

    const otherRes = mockRes();
    await companySellers.listSellers({ user: { companyId: otherCompany._id }, query: {} }, otherRes);
    expect(otherRes.body.count).toBe(0);
  });
});

describe("requireApprovedSeller gate", () => {
  function runGate(user) {
    return new Promise((resolve) => {
      const res = mockRes();
      let nextCalled = false;
      requireApprovedSeller({ user }, res, () => { nextCalled = true; resolve({ res, nextCalled }); })
        .then(() => resolve({ res, nextCalled }));
    });
  }

  test("blocks a seller with no active PC (403)", async () => {
    const { res, nextCalled } = await runGate({ sellerId, principalType: "seller" });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  test("allows a seller once a PC is issued", async () => {
    await mintPc(sellerId, company._id);
    const { nextCalled } = await runGate({ sellerId, principalType: "seller" });
    expect(nextCalled).toBe(true);
  });

  test("blocks a non-seller principal (403)", async () => {
    const { res, nextCalled } = await runGate({ companyId: company._id, principalType: "company" });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
