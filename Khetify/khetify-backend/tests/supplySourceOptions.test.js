const mongoose = require("mongoose");
require("../model/Company/Company");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Seller = require("../model/Seller/Seller");
const SupplyOrder = require("../model/Supply/SupplyOrder");
const supplyCtrl = require("../controller/Supply/supplyController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyId, productId, wh1, wh2, orderId;

beforeEach(async () => {
  const c = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: "Co" } });
  companyId = c._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 270 });
  productId = p._id;
  wh1 = await Warehouse.create({ companyId, name: "Khargone Centre", code: "WH-KH" });
  wh2 = await Warehouse.create({ companyId, name: "Katni Hub", code: "WH-KT" });
  const seller = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Krishna" }, supplyingCompanyId: companyId, linkStatus: "approved", status: "active" });

  // WH1: plenty (non-expired).
  await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: wh1._id, batchNumber: "A1", lotNumber: "A1", expiryDate: new Date("2030-01-01"), offlineStock: 10, availableStock: 10 });
  // WH2: only 3 usable (non-expired) + a big EXPIRED lot that must be ignored.
  await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: wh2._id, batchNumber: "B1", lotNumber: "B1", expiryDate: new Date("2030-01-01"), offlineStock: 3, availableStock: 3 });
  await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: wh2._id, batchNumber: "B2", lotNumber: "B2", expiryDate: new Date("2000-01-01"), offlineStock: 100, availableStock: 100 });

  const order = await SupplyOrder.create({ sellerId: seller._id, companyId, items: [{ productId, quantity: 5 }], warehouseId: wh1._id, status: "requested" });
  orderId = order._id;
});

const req = (id) => ({ user: { companyId, id: companyId }, params: { id } });

describe("GET /supply-order/:id/source-options", () => {
  test("reports per-warehouse availability (non-expired only) and canFulfill", async () => {
    const res = mockRes();
    await supplyCtrl.getSourceOptions(req(orderId), res);
    expect(res.body.success).toBe(true);

    const byId = Object.fromEntries(res.body.data.map((w) => [String(w.warehouseId), w]));
    const a = byId[String(wh1._id)];
    const b = byId[String(wh2._id)];

    expect(a.items[0].availableQty).toBe(10);
    expect(a.items[0].requiredQty).toBe(5);
    expect(a.canFulfill).toBe(true);

    expect(b.items[0].availableQty).toBe(3); // expired 100-lot excluded
    expect(b.canFulfill).toBe(false);

    // fulfilling warehouse sorted first
    expect(String(res.body.data[0].warehouseId)).toBe(String(wh1._id));
  });

  test("404 for an order not owned by the company", async () => {
    const res = mockRes();
    await supplyCtrl.getSourceOptions({ user: { companyId: new mongoose.Types.ObjectId(), id: companyId }, params: { id: orderId } }, res);
    expect(res.statusCode).toBe(404);
  });
});
