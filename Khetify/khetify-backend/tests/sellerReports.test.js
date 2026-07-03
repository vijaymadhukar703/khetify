const mongoose = require("mongoose");
require("../model/Company/Company"); // register Company (Inventory populate path)
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const User = require("../model/User/User");
const sellerReportService = require("../services/sellerReportService");
const ctrl = require("../controller/Seller/sellerReportController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyId, sellerId, productId, whA, whB, manager;
beforeEach(async () => {
  companyId = new mongoose.Types.ObjectId();
  sellerId = new mongoose.Types.ObjectId();
  productId = (await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 100 }))._id;
  whA = await Warehouse.create({ sellerId, name: "WH-A" });
  whB = await Warehouse.create({ sellerId, name: "WH-B" });
  // A-lot: 20 units, low (threshold 50). B-lot: 10 units, healthy.
  await Inventory.create({ productId, ownerType: "seller", ownerId: sellerId, warehouseId: whA._id, batchNumber: "A-1", lotNumber: "A-1", offlineStock: 20, availableStock: 20, lowStockThreshold: 50 });
  await Inventory.create({ productId, ownerType: "seller", ownerId: sellerId, warehouseId: whB._id, batchNumber: "B-1", lotNumber: "B-1", offlineStock: 10, availableStock: 10 });
  // a manager assigned to WH-A only
  manager = await User.create({ ownerType: "seller", ownerId: sellerId, name: "Mgr", role: "seller_manager", status: "active", warehouseIds: [whA._id] });
});

const adminReq = (extra = {}) => ({ user: { id: sellerId, sellerId, principalType: "seller", role: "seller_admin" }, query: {}, params: {}, ...extra });
const mgrReq = (extra = {}) => ({ user: { id: manager._id, sellerId, principalType: "seller", role: "seller_manager" }, query: {}, params: {}, ...extra });

describe("seller report service — owner-scoped, MRP-valued", () => {
  test("stock-on-hand values at MRP and is seller-scoped", async () => {
    const rows = await sellerReportService.runReport("stock-on-hand", sellerId, {});
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.lot === "A-1");
    expect(a.mrp).toBe(100);
    expect(a.value).toBe(2000); // 20 × 100 (MRP, never cost)
  });

  test("warehouse scope restricts rows to the manager's warehouse", async () => {
    const scoped = await sellerReportService.runReport("stock-on-hand", sellerId, { warehouseIds: [String(whA._id)] });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].lot).toBe("A-1");
  });

  test("low-stock returns only lots at/below the reorder level", async () => {
    const rows = await sellerReportService.runReport("low-stock", sellerId, {});
    expect(rows.map((r) => r.lot)).toEqual(["A-1"]);
  });

  test("dashboard KPIs: full value for the owner, scoped slice for the manager", async () => {
    const all = await sellerReportService.dashboard(sellerId, {});
    expect(all.stockValue).toBe(3000); // (20 + 10) × 100
    expect(all.totalLots).toBe(2);
    expect(all.lowStock).toBe(1);

    const scoped = await sellerReportService.dashboard(sellerId, { warehouseIds: [String(whA._id)] });
    expect(scoped.stockValue).toBe(2000); // WH-A only
    expect(scoped.totalLots).toBe(1);
  });
});

describe("seller report controller — warehouse-scoped via the token", () => {
  test("admin run sees all; manager run is auto-scoped to their warehouse", async () => {
    const adminRes = mockRes();
    await ctrl.run({ ...adminReq(), params: { name: "stock-on-hand" } }, adminRes);
    expect(adminRes.body.count).toBe(2);

    const mgrRes = mockRes();
    await ctrl.run({ ...mgrReq(), params: { name: "stock-on-hand" } }, mgrRes);
    expect(mgrRes.body.count).toBe(1);
    expect(mgrRes.body.data[0].lot).toBe("A-1");
  });

  test("a manager cannot request a warehouse outside their scope (403)", async () => {
    const res = mockRes();
    await ctrl.run({ ...mgrReq({ query: { warehouseId: String(whB._id) } }), params: { name: "stock-on-hand" } }, res);
    expect(res.statusCode).toBe(403);
  });

  test("dashboard controller returns the manager's scoped KPIs", async () => {
    const res = mockRes();
    await ctrl.dashboard(mgrReq(), res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stockValue).toBe(2000);
  });

  test("unknown report name → 404", async () => {
    const res = mockRes();
    await ctrl.run({ ...adminReq(), params: { name: "nope" } }, res);
    expect(res.statusCode).toBe(404);
  });
});
