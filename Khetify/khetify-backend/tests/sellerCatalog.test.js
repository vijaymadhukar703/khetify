const mongoose = require("mongoose");
const Seller = require("../model/Seller/Seller");
const Product = require("../model/Company/productModel");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const ctrl = require("../controller/Seller/sellerCatalogController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

// Catalog visibility is now gated on an ACTIVE PC for the company.
async function mintPc(sellerId, companyId) {
  const until = new Date(); until.setFullYear(until.getFullYear() + 1);
  await PrincipalCertificate.create({
    pcNumber: `KH-PC-${String(companyId).slice(-4)}-${Date.now()}-${Math.round(Math.random() * 1e6)}`, sellerId, companyId,
    validFrom: new Date(), validUntil: until, status: "active",
    govt: { required: false, status: "not_required" }, issuedAt: new Date(),
  });
}

let companyA, companyB, approvedSeller, pendingSeller;

beforeEach(async () => {
  companyA = new mongoose.Types.ObjectId();
  companyB = new mongoose.Types.ObjectId();

  // company A products (one active+uploaded, one draft)
  await Product.create({ companyId: companyA, productName: "Urea 45kg", category: "Fertilizers", skuNumber: "A-UREA", mrp: 270, costPrice: 240, productStatus: "active", productUpload: "uploaded" });
  await Product.create({ companyId: companyA, productName: "Draft Item", category: "Seeds", skuNumber: "A-DRAFT", mrp: 100, costPrice: 80, productStatus: "inactive", productUpload: "saveDraft" });
  // company B product — must never appear for an A-authorized seller
  await Product.create({ companyId: companyB, productName: "Foreign Seed", category: "Seeds", skuNumber: "B-SEED", mrp: 50, costPrice: 30, productStatus: "active", productUpload: "uploaded" });

  // approvedSeller holds an ACTIVE PC for company A; pendingSeller holds none.
  approvedSeller = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Krishna" }, supplyingCompanyId: companyA, status: "active" });
  await mintPc(approvedSeller._id, companyA);
  pendingSeller = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Pending" }, supplyingCompanyId: companyA, linkStatus: "pending" });
});

const asSeller = (sellerId, query = {}, params = {}) => ({ user: { sellerId, principalType: "seller" }, query, params });

describe("seller catalog: scoped to the linked company, read-only, cost-free", () => {
  test("returns ONLY the linked company's active+uploaded products", async () => {
    const res = mockRes();
    await ctrl.getSellerProducts(asSeller(approvedSeller._id), res);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1); // only "Urea 45kg" (active+uploaded, company A)
    const skus = res.body.data.map((p) => p.skuNumber);
    expect(skus).toEqual(["A-UREA"]);
    expect(skus).not.toContain("B-SEED");  // not company B
    expect(skus).not.toContain("A-DRAFT"); // not a draft
  });

  test("payload NEVER contains costPrice (or any cost field)", async () => {
    const res = mockRes();
    await ctrl.getSellerProducts(asSeller(approvedSeller._id), res);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/costprice/i);
    for (const p of res.body.data) {
      expect(p.costPrice).toBeUndefined();
      expect(p.mrp).toBeDefined(); // MRP IS exposed
    }
  });

  test("a seller authorized for a DIFFERENT company sees none of company A's products", async () => {
    const sellerB = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "B Co" }, supplyingCompanyId: companyB, status: "active" });
    await mintPc(sellerB._id, companyB);
    const res = mockRes();
    await ctrl.getSellerProducts(asSeller(sellerB._id), res);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].skuNumber).toBe("B-SEED");
  });

  test("a seller without an active PC is blocked (403)", async () => {
    const res = mockRes();
    await ctrl.getSellerProducts(asSeller(pendingSeller._id), res);
    expect(res.statusCode).toBe(403);
  });

  test("detail returns the product (cost-free) only when it belongs to the linked company", async () => {
    const a = await Product.findOne({ companyId: companyA, skuNumber: "A-UREA" });
    const b = await Product.findOne({ companyId: companyB, skuNumber: "B-SEED" });

    const ok = mockRes();
    await ctrl.getSellerProduct(asSeller(approvedSeller._id, {}, { id: a._id }), ok);
    expect(ok.body.data.skuNumber).toBe("A-UREA");
    expect(ok.body.data.costPrice).toBeUndefined();

    const foreign = mockRes();
    await ctrl.getSellerProduct(asSeller(approvedSeller._id, {}, { id: b._id }), foreign);
    expect(foreign.statusCode).toBe(404);
  });
});
