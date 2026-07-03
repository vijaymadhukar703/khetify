const mongoose = require("mongoose");
require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Seller = require("../model/Seller/Seller");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const User = require("../model/User/User");
const ctrl = require("../controller/Seller/sellerTransferController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const adminReq = (query) => ({ user: { id: sellerId, sellerId, principalType: "seller", role: "seller_admin" }, query, params: {}, body: {} });

let companyId, sellerId, productA, productB, whA, whB, manager;
beforeEach(async () => {
  companyId = new mongoose.Types.ObjectId();
  sellerId = (await Seller.create({ email: `s-${new mongoose.Types.ObjectId()}@x.com`, passwordHash: "x", status: "active", linkStatus: "approved", sellerInfo: { businessName: "S" } }))._id;
  productA = (await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 100 }))._id;
  productB = (await Product.create({ companyId, productName: "Zinc", skuNumber: "ZN", mrp: 50 }))._id;
  whA = await Warehouse.create({ sellerId, name: "WH-A" });
  whB = await Warehouse.create({ sellerId, name: "WH-B" });
  // WH-A holds: Urea (two lots, 30+20 in stock) and Zinc (a depleted lot, 0).
  await Inventory.create({ productId: productA, ownerType: "seller", ownerId: sellerId, warehouseId: whA._id, batchNumber: "A1", lotNumber: "A1", offlineStock: 30, availableStock: 30 });
  await Inventory.create({ productId: productA, ownerType: "seller", ownerId: sellerId, warehouseId: whA._id, batchNumber: "A2", lotNumber: "A2", offlineStock: 20, availableStock: 20 });
  await Inventory.create({ productId: productB, ownerType: "seller", ownerId: sellerId, warehouseId: whA._id, batchNumber: "Z0", lotNumber: "Z0", offlineStock: 0, availableStock: 0 });
  // WH-B holds nothing.
  manager = await User.create({ ownerType: "seller", ownerId: sellerId, name: "Mgr", role: "seller_manager", status: "active", warehouseIds: [whA._id] });
});

describe("seller transfer product-options (in-stock lots of the From warehouse)", () => {
  test("lists only in-stock products held in the chosen warehouse, grouped with available qty", async () => {
    const res = mockRes();
    await ctrl.warehouseStock(adminReq({ warehouseId: String(whA._id) }), res);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);            // only Urea has stock; Zinc (0) excluded
    expect(res.body.data[0].productName).toBe("Urea");
    expect(res.body.data[0].availableQty).toBe(50);   // 30 + 20 across its lots
    expect(res.body.data[0].lots).toHaveLength(2);
  });

  test("a warehouse with no stock returns an empty list (not an error)", async () => {
    const res = mockRes();
    await ctrl.warehouseStock(adminReq({ warehouseId: String(whB._id) }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test("missing warehouseId → 400", async () => {
    const res = mockRes();
    await ctrl.warehouseStock(adminReq({}), res);
    expect(res.statusCode).toBe(400);
  });

  test("a manager cannot read stock for a warehouse outside their scope (403)", async () => {
    const req = { user: { id: manager._id, sellerId, principalType: "seller", role: "seller_manager" }, query: { warehouseId: String(whB._id) }, params: {}, body: {} };
    const res = mockRes();
    await ctrl.warehouseStock(req, res);
    expect(res.statusCode).toBe(403);
  });
});

describe("seller transfer DESTINATION options = the seller ACCOUNT's warehouses (not manager-scoped)", () => {
  test("a manager scoped to ONE warehouse still gets ALL the seller's warehouses for destination", async () => {
    // manager.warehouseIds = [whA] only — but the account owns whA + whB.
    const req = { user: { id: manager._id, sellerId, principalType: "seller", role: "seller_manager" }, query: {}, params: {}, body: {} };
    const res = mockRes();
    await ctrl.accountWarehouses(req, res);
    expect(res.body.success).toBe(true);
    const names = res.body.data.map((w) => w.name).sort();
    expect(names).toEqual(["WH-A", "WH-B"]); // BOTH, independent of warehouseIds
    // → frontend lists destinations = these minus the source, and the
    //   "need 2 warehouses" guard sees 2 (no false message).
  });

  test("strictly seller-scoped: another seller's warehouses never appear", async () => {
    const otherSeller = await Seller.create({ email: `o-${new mongoose.Types.ObjectId()}@x.com`, passwordHash: "x", status: "active", linkStatus: "approved", sellerInfo: { businessName: "Other" } });
    await Warehouse.create({ sellerId: otherSeller._id, name: "Foreign WH" });
    const res = mockRes();
    await ctrl.accountWarehouses(adminReq({}), res);
    expect(res.body.data.map((w) => w.name)).not.toContain("Foreign WH");
    expect(res.body.data).toHaveLength(2);
  });
});
