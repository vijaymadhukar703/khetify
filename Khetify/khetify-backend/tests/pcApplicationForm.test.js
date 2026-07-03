const mongoose = require("mongoose");
require("../model/Company/Company");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Seller = require("../model/Seller/Seller");
const SellerDocument = require("../model/PC/SellerDocument");
const PCApplication = require("../model/PC/PCApplication");
const CompanyPcForm = require("../model/PC/CompanyPcForm");
const pcService = require("../services/pcService");
const companyPcCtrl = require("../controller/Company/companyPcController");
const sellerPcCtrl = require("../controller/Seller/sellerPcController");
const sellerCatalogCtrl = require("../controller/Seller/sellerCatalogController");

process.env.STORAGE_DRIVER = "local";

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyId, sellerId, productId;

// A seller with a COMPLETE profile (the prerequisite to apply).
async function completeSeller() {
  const s = await Seller.create({
    passwordHash: "x", status: "active", linkStatus: "unlinked",
    email: "ravi@x.com", phone: "9000000000",
    sellerInfo: { businessName: "Ravi Traders" },
    verification: { gstin: "27ABCDE1234F1Z5", pan: "ABCDE1234F" },
    contact: { ownerName: "Ravi Kumar", officialEmail: "ravi@x.com", officialPhone: "9000000000", address: { line: "Mandi Rd", city: "Indore", state: "MP", pincode: "452001" } },
  });
  await SellerDocument.create({ sellerId: s._id, docType: "gst", fileKey: `sellers/${s._id}/gst.pdf`, fileName: "gst.pdf" });
  await SellerDocument.create({ sellerId: s._id, docType: "pan", fileKey: `sellers/${s._id}/pan.pdf`, fileName: "pan.pdf" });
  return s._id;
}

beforeEach(async () => {
  companyId = (await Company.create({ fullName: "Alpha Agri", email: `a-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: "Alpha Agri" } }))._id;
  productId = (await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 270, productStatus: "active", productUpload: "uploaded" }))._id;
  sellerId = await completeSeller();
});

const companyReq = (extra = {}) => ({ user: { companyId, id: companyId }, body: {}, params: {}, query: {}, ...extra });
const sellerReq = (extra = {}) => ({ user: { sellerId, id: sellerId, principalType: "seller" }, body: {}, params: {}, query: {}, ...extra });

describe("PART 2 — company-configurable PC application form", () => {
  test("defaults to a sensible form when none is saved", async () => {
    const res = mockRes();
    await companyPcCtrl.getForm(companyReq(), res);
    const keys = res.body.data.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["businessName", "pan", "gstin"]));
    // default profile mappings drive autofill
    expect(res.body.data.fields.find((f) => f.key === "pan").profileField).toBe("compliance.pan");
  });

  test("a company can add / edit / reorder fields and they persist", async () => {
    const fields = [
      { key: "gstin", label: "GSTIN", type: "text", required: true, profileField: "compliance.gstin" },
      { key: "warehouseCount", label: "How many warehouses?", type: "number", required: true },
      { key: "region", label: "Region", type: "select", required: false, options: ["North", "South"] },
    ];
    const save = mockRes();
    await companyPcCtrl.saveForm(companyReq({ body: { fields } }), save);
    expect(save.body.success).toBe(true);
    expect(save.body.data.fields.map((f) => f.key)).toEqual(["gstin", "warehouseCount", "region"]);

    const got = mockRes();
    await companyPcCtrl.getForm(companyReq(), got);
    expect(got.body.data.fields).toHaveLength(3);
    expect(got.body.data.fields[2].options).toEqual(["North", "South"]);
    expect(await CompanyPcForm.countDocuments({ companyId })).toBe(1);
  });

  test("saving an empty form or a duplicate key is rejected", async () => {
    const e1 = mockRes();
    await companyPcCtrl.saveForm(companyReq({ body: { fields: [] } }), e1);
    expect(e1.statusCode).toBe(400);
    const e2 = mockRes();
    await companyPcCtrl.saveForm(companyReq({ body: { fields: [{ key: "x", label: "X" }, { key: "x", label: "Y" }] } }), e2);
    expect(e2.statusCode).toBe(400);
  });
});

describe("PART 3 — seller loads the company form, profile fields auto-fill", () => {
  test("getApplyForm returns the company's fields + profile prefill + profile state", async () => {
    const res = mockRes();
    await sellerPcCtrl.getApplyForm(sellerReq({ params: { companyId } }), res);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.profile.complete).toBe(true);
    // profile-mapped fields are pre-populated from the seller's profile
    expect(d.prefill.gstin).toBe("27ABCDE1234F1Z5");
    expect(d.prefill.pan).toBe("ABCDE1234F");
    expect(d.prefill.businessName).toBe("Ravi Traders");
    expect(d.prefill.address).toMatch(/Mandi Rd/);
    expect(d.alreadyApplied).toBe(false);
  });

  test("an incomplete profile is reported and blocks applying", async () => {
    const bareId = (await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Bare" } }))._id;
    const res = mockRes();
    await sellerPcCtrl.getApplyForm({ user: { sellerId: bareId, principalType: "seller" }, params: { companyId } }, res);
    expect(res.body.data.profile.complete).toBe(false);
    expect(res.body.data.profile.missing.length).toBeGreaterThan(0);

    const apply = mockRes();
    await sellerPcCtrl.createApplication({ user: { sellerId: bareId, principalType: "seller" }, body: { companyId } }, apply);
    expect(apply.statusCode).toBe(400);
  });

  test("submitting the form creates a PCApplication with the answers + auto-attached KYC docs", async () => {
    const res = mockRes();
    await sellerPcCtrl.createApplication(sellerReq({ body: { companyId, formAnswers: { productCategories: "fertilizer, seeds", warehouseCount: "3" } } }), res);
    expect(res.statusCode).toBe(201);
    const app = await PCApplication.findById(res.body.data._id);
    expect(app.formAnswers.warehouseCount).toBe("3");
    expect(app.productCategories).toEqual(["fertilizer", "seeds"]); // parsed from the answer
    expect(app.documentIds.length).toBeGreaterThanOrEqual(2); // gst + pan auto-attached
    expect(app.formSnapshot.length).toBeGreaterThan(0); // immutable snapshot stored
  });

  test("a duplicate active application to the same company is blocked", async () => {
    await sellerPcCtrl.createApplication(sellerReq({ body: { companyId } }), mockRes());
    const dup = mockRes();
    await sellerPcCtrl.createApplication(sellerReq({ body: { companyId } }), dup);
    expect(dup.statusCode).toBe(409);
  });
});

describe("PART 4–5 — issue gates selling on active PC; reject allows re-apply", () => {
  async function applyReviewSignIssue() {
    const app = await pcService.applyForPc({ sellerId, companyId, formAnswers: { productCategories: "fertilizer" } });
    await pcService.reviewApp(companyId, app._id, companyId);
    await pcService.approveApp(companyId, app._id, companyId);
    await pcService.signAgreement({ sellerId, applicationId: app._id, signedName: "Ravi", ip: "1.1.1.1" });
    await pcService.issuePc(companyId, app._id, { issuedBy: companyId });
    return app;
  }

  test("before issue the seller can't see the company's catalog; after Issue they can", async () => {
    const before = mockRes();
    await sellerCatalogCtrl.getSellerProducts(sellerReq({ query: { companyId: String(companyId) } }), before);
    expect(before.statusCode).toBe(403); // gated on active PC, not a separate link

    await applyReviewSignIssue();

    const after = mockRes();
    await sellerCatalogCtrl.getSellerProducts(sellerReq({ query: { companyId: String(companyId) } }), after);
    expect(after.body.success).toBe(true);
    expect(after.body.data.map((p) => p.skuNumber)).toContain("UR");
    expect(await pcService.hasActivePc(sellerId, companyId)).toBe(true);
  });

  test("reject → the seller can re-apply to the same company", async () => {
    const app = await pcService.applyForPc({ sellerId, companyId });
    await pcService.rejectApp(companyId, app._id, companyId, { reason: "incomplete" });
    expect((await PCApplication.findById(app._id)).status).toBe("rejected");
    // a fresh application is allowed (the rejected one is terminal)
    const reapply = mockRes();
    await sellerPcCtrl.createApplication(sellerReq({ body: { companyId } }), reapply);
    expect(reapply.statusCode).toBe(201);
  });
});
