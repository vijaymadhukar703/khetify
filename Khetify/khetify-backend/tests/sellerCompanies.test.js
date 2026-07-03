const mongoose = require("mongoose");
require("../model/Company/Company");
const Company = require("../model/Company/Company");
const Seller = require("../model/Seller/Seller");
const PCApplication = require("../model/PC/PCApplication");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const pcService = require("../services/pcService");
const sellerCompanyCtrl = require("../controller/Seller/sellerCompanyController");
const sellerAuthCtrl = require("../controller/Seller/sellerAuthController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const sellerReq = (sellerId, { params = {}, query = {}, body = {} } = {}) => ({ user: { sellerId, id: sellerId, principalType: "seller" }, params, query, body });

async function mintPc(sellerId, companyId) {
  const until = new Date(); until.setFullYear(until.getFullYear() + 1);
  await PrincipalCertificate.create({
    pcNumber: `KH-PC-${String(companyId).slice(-4)}-${Date.now()}-${Math.round(Math.random() * 1e6)}`, sellerId, companyId,
    validFrom: new Date(), validUntil: until, status: "active",
    govt: { required: false, status: "not_required" }, issuedAt: new Date(),
  });
  await pcService.reconcileLink(sellerId, companyId);
}

let companyA, companyB, sellerId;

beforeEach(async () => {
  const a = await Company.create({ fullName: "Alpha Agri", email: `a-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: "Alpha Agri" }, businessContact: { region: "Indore" } });
  const b = await Company.create({ fullName: "Beta Crop", email: `b-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: "Beta Crop" }, businessContact: { region: "Bhopal" } });
  companyA = a._id; companyB = b._id;
  const s = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Krishna Traders" }, status: "pending", linkStatus: "unlinked" });
  sellerId = s._id;
});

describe("seller Companies section (derived from PC issuance)", () => {
  test("companies list shows an issued PC as 'active' and an in-progress application by status", async () => {
    // an in-progress application to companyB
    await PCApplication.create({ sellerId, companyId: companyB, status: "applied", timeline: [] });
    // an issued (active) PC for companyA
    await mintPc(sellerId, companyA);

    const res = mockRes();
    await sellerCompanyCtrl.getSellerCompanyLinks(sellerReq(sellerId), res);
    const byId = Object.fromEntries(res.body.data.map((r) => [String(r._id), r]));
    expect(byId[String(companyA)].status).toBe("active");
    expect(byId[String(companyA)].pcNumber).toBeTruthy();
    expect(byId[String(companyB)].status).toBe("applied");
  });

  test("?status=active narrows to companies that issued a PC", async () => {
    await PCApplication.create({ sellerId, companyId: companyB, status: "applied", timeline: [] });
    await mintPc(sellerId, companyA);
    const res = mockRes();
    await sellerCompanyCtrl.getSellerCompanyLinks(sellerReq(sellerId, { query: { status: "active" } }), res);
    const ids = res.body.data.map((c) => String(c._id));
    expect(ids).toContain(String(companyA));
    expect(ids).not.toContain(String(companyB));
  });

  test("search excludes companies the seller is already engaged with (active PC or open application)", async () => {
    await mintPc(sellerId, companyA); // engaged with A via active PC
    const res = mockRes();
    await sellerCompanyCtrl.searchSellerCompanies(sellerReq(sellerId, { query: { q: "" } }), res);
    const ids = res.body.data.map((c) => String(c._id));
    expect(ids).toContain(String(companyB));
    expect(ids).not.toContain(String(companyA));
  });

  test("ack-approval flips the one-time banner flag", async () => {
    await mintPc(sellerId, companyA);
    expect((await Seller.findById(sellerId)).linkApprovalAcknowledged).toBe(false);
    const res = mockRes();
    await sellerAuthCtrl.ackApproval(sellerReq(sellerId), res);
    expect(res.body.success).toBe(true);
    expect((await Seller.findById(sellerId)).linkApprovalAcknowledged).toBe(true);
  });
});
