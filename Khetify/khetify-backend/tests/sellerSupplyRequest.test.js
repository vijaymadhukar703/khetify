const mongoose = require("mongoose");
require("../model/Company/Company");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Seller = require("../model/Seller/Seller");
const Warehouse = require("../model/Warehouse/Warehouse");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const pcService = require("../services/pcService");
const sellerSupply = require("../controller/Seller/sellerSupplyController");
const companySupply = require("../controller/Supply/supplyController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const sellerReq = (sellerId, body) => ({ user: { sellerId, principalType: "seller" }, body });

// An active PC for (seller, company) is now the authorization to order supply.
async function mintPc(sellerId, companyId) {
  const until = new Date(); until.setFullYear(until.getFullYear() + 1);
  await PrincipalCertificate.create({
    pcNumber: `KH-PC-${String(companyId).slice(-4)}-${Date.now()}-${Math.round(Math.random() * 1e6)}`, sellerId, companyId,
    validFrom: new Date(), validUntil: until, status: "active",
    govt: { required: false, status: "not_required" }, issuedAt: new Date(),
  });
  await pcService.reconcileLink(sellerId, companyId);
}

let sellerId, companyA, companyB, companyC, prodA, prodB, sellerWh;
beforeEach(async () => {
  const mk = async (n) => (await Company.create({ fullName: n, email: `${n}-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: n } }))._id;
  companyA = await mk("Alpha");
  companyB = await mk("Beta");
  companyC = await mk("Gamma"); // no PC issued to this seller
  prodA = (await Product.create({ companyId: companyA, productName: "Urea", skuNumber: "A-UR", mrp: 100 }))._id;
  prodB = (await Product.create({ companyId: companyB, productName: "Zinc", skuNumber: "B-ZN", mrp: 50 }))._id;
  sellerId = (await Seller.create({ passwordHash: "x", status: "active", linkStatus: "unlinked", sellerInfo: { businessName: "Krishna" } }))._id;
  sellerWh = await Warehouse.create({ sellerId, name: "Mumbai" });
  // Active PCs from A and B only (not C).
  await mintPc(sellerId, companyA);
  await mintPc(sellerId, companyB);
});

describe("seller supply request targets a company that ISSUED a PC (active-PC gate)", () => {
  test("order is created against the chosen PC-authorized company and the COMPANY sees it", async () => {
    const res = mockRes();
    await sellerSupply.createSellerSupplyOrder(sellerReq(sellerId, { companyId: companyA, warehouseId: sellerWh._id, items: [{ productId: prodA, quantity: 100 }] }), res);
    expect(res.statusCode).toBe(201);
    expect(String(res.body.data.companyId)).toBe(String(companyA));

    const aRes = mockRes();
    await companySupply.getSupplyOrders({ user: { companyId: companyA }, query: {} }, aRes);
    expect(aRes.body.data.some((o) => String(o._id) === String(res.body.data._id))).toBe(true);

    const bRes = mockRes();
    await companySupply.getSupplyOrders({ user: { companyId: companyB }, query: {} }, bRes);
    expect(bRes.body.data.some((o) => String(o._id) === String(res.body.data._id))).toBe(false);
  });

  test("ordering from a company that hasn't issued a PC is rejected (403)", async () => {
    const res = mockRes();
    await sellerSupply.createSellerSupplyOrder(sellerReq(sellerId, { companyId: companyC, warehouseId: sellerWh._id, items: [{ productId: prodA, quantity: 5 }] }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/PC|Principal Certificate/i);
  });

  test("a product that isn't from the chosen company is rejected (400)", async () => {
    const res = mockRes();
    await sellerSupply.createSellerSupplyOrder(sellerReq(sellerId, { companyId: companyA, warehouseId: sellerWh._id, items: [{ productId: prodB, quantity: 5 }] }), res);
    expect(res.statusCode).toBe(400);
  });

  test("a seller with NO active PC can't request supply (403)", async () => {
    const lonely = (await Seller.create({ passwordHash: "x", status: "active", sellerInfo: { businessName: "Solo" } }))._id;
    const wh = await Warehouse.create({ sellerId: lonely, name: "WH" });
    const res = mockRes();
    await sellerSupply.createSellerSupplyOrder(sellerReq(lonely, { companyId: companyA, warehouseId: wh._id, items: [{ productId: prodA, quantity: 5 }] }), res);
    expect(res.statusCode).toBe(403);
  });

  test("with a single PC-authorized company, companyId may be omitted", async () => {
    const solo = (await Seller.create({ passwordHash: "x", status: "active", sellerInfo: { businessName: "One" } }))._id;
    const wh = await Warehouse.create({ sellerId: solo, name: "WH" });
    await mintPc(solo, companyA);
    const res = mockRes();
    await sellerSupply.createSellerSupplyOrder(sellerReq(solo, { warehouseId: wh._id, items: [{ productId: prodA, quantity: 5 }] }), res);
    expect(res.statusCode).toBe(201);
    expect(String(res.body.data.companyId)).toBe(String(companyA));
  });
});
