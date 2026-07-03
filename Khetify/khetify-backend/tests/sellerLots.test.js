const mongoose = require("mongoose");
require("../model/Company/Company"); // register Company schema (getLots populates productId.companyId)
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const lotService = require("../services/lotService");
const ctrl = require("../controller/Seller/sellerInventoryController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyId, sellerId, productId, companyWh, sellerWh;
beforeEach(async () => {
  companyId = new mongoose.Types.ObjectId();
  sellerId = new mongoose.Types.ObjectId();
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 270 });
  productId = p._id;
  companyWh = await Warehouse.create({ companyId, name: "Co WH" });
  sellerWh = await Warehouse.create({ sellerId, name: "Seller WH" });

  // a company lot and a seller lot (same product, different owners)
  await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id, batchNumber: "C-1", lotNumber: "C-1", offlineStock: 50, availableStock: 50 });
  await Inventory.create({ productId, ownerType: "seller", ownerId: sellerId, warehouseId: sellerWh._id, batchNumber: "S-1", lotNumber: "S-1", expiryDate: new Date("2027-01-01"), offlineStock: 30, availableStock: 30 });
});

describe("getLots is owner-aware + backward compatible", () => {
  test("default (no ownerType) returns ONLY company lots — company caller unchanged", async () => {
    const rows = await lotService.getLots(companyId);
    expect(rows.length).toBe(1);
    expect(rows[0].ownerType).toBe("company");
    expect(rows[0].lotNumber).toBe("C-1");
  });

  test("ownerType:'seller' returns ONLY that seller's lots", async () => {
    const rows = await lotService.getLots(sellerId, { ownerType: "seller" });
    expect(rows.length).toBe(1);
    expect(rows[0].ownerType).toBe("seller");
    expect(rows[0].lotNumber).toBe("S-1");
  });

  test("a seller id queried as a company returns nothing (no cross-owner leak)", async () => {
    const rows = await lotService.getLots(sellerId); // default company
    expect(rows.length).toBe(0);
  });
});

describe("GET /api/seller/lots controller", () => {
  test("returns only the caller seller's lots, product + warehouse populated", async () => {
    const res = mockRes();
    await ctrl.getSellerLots({ user: { sellerId, principalType: "seller" }, query: {} }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    const row = res.body.data[0];
    expect(row.lotNumber).toBe("S-1");
    expect(row.productId.productName).toBe("Urea"); // populated
    expect(row.warehouseId.name).toBe("Seller WH");  // populated
    // no company lot leaked
    expect(res.body.data.every((r) => r.ownerType === "seller")).toBe(true);
  });
});
