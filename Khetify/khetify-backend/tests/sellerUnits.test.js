const mongoose = require("mongoose");
require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Seller = require("../model/Seller/Seller");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const svc = require("../services/barcodeService");
const lotService = require("../services/lotService");
const sellerBarcode = require("../controller/Seller/sellerBarcodeController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const invSum = (r) => (r.onlineStock || 0) + (r.offlineStock || 0) - (r.reservedStock || 0);

let companyId, productId, companyWh, sellerId, sellerWh, lot;
const performedBy = new mongoose.Types.ObjectId();

beforeEach(async () => {
  companyId = new mongoose.Types.ObjectId();
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 270 });
  productId = p._id;
  companyWh = await Warehouse.create({ companyId, name: "Co WH" });
  const seller = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Krishna" }, supplyingCompanyId: companyId, linkStatus: "approved", status: "active" });
  sellerId = seller._id;
  sellerWh = await Warehouse.create({ sellerId, name: "Seller WH" });

  lot = await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id, batchNumber: "L1", lotNumber: "L1", expiryDate: new Date("2027-01-01"), offlineStock: 5, availableStock: 5 });
});

describe("supply transfers units with the goods (Phase 4b)", () => {
  test("moves up to qty available units to the seller, re-points inventoryId, logs events, keeps serials unique", async () => {
    await svc.generateUnits(companyId, lot._id, 5); // 5 labeled units on the company lot
    const refId = new mongoose.Types.ObjectId();

    await lotService.supplyTransfer({ companyId, sellerId, sourceWarehouseId: companyWh._id, destWarehouseId: sellerWh._id, items: [{ productId, quantity: 2 }], refId, performedBy });

    const sellerLot = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId, batchNumber: "L1" });
    expect(sellerLot.availableStock).toBe(2);

    // exactly 2 units now owned by the seller, re-pointed to the seller lot, status in_stock
    const sellerUnits = await UnitSerial.find({ ownerType: "seller", ownerId: sellerId });
    expect(sellerUnits.length).toBe(2);
    expect(sellerUnits.every((u) => String(u.inventoryId) === String(sellerLot._id))).toBe(true);
    expect(sellerUnits.every((u) => u.status === "in_stock")).toBe(true);
    // originating company unchanged (immutable trace root) + serial unchanged
    expect(sellerUnits.every((u) => String(u.companyId) === String(companyId))).toBe(true);

    // 3 units remain with the company
    expect(await UnitSerial.countDocuments({ ownerType: "company", ownerId: companyId })).toBe(3);

    // serials still globally unique (no duplicates introduced)
    const all = await UnitSerial.find({ lotNumber: "L1" });
    expect(new Set(all.map((u) => u.serial)).size).toBe(all.length);

    // a supplied_to_seller event per moved unit
    const events = await UnitEvent.find({ event: "supplied_to_seller", refType: "SupplyOrder" });
    expect(events.length).toBe(2);
  });

  test("only the LABELED portion transfers units; unlabeled remainder is lot-level only", async () => {
    await svc.generateUnits(companyId, lot._id, 3); // only 3 of 5 labeled
    await lotService.supplyTransfer({ companyId, sellerId, sourceWarehouseId: companyWh._id, destWarehouseId: sellerWh._id, items: [{ productId, quantity: 5 }], refId: new mongoose.Types.ObjectId(), performedBy });

    const sellerLot = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId, batchNumber: "L1" });
    expect(sellerLot.availableStock).toBe(5); // all 5 units of stock moved at lot level
    expect(await UnitSerial.countDocuments({ ownerType: "seller", ownerId: sellerId })).toBe(3); // only 3 labeled units moved
    expect(invSum(sellerLot)).toBe(sellerLot.availableStock);
  });
});

describe("seller barcode scope (owner-aware)", () => {
  beforeEach(async () => {
    await svc.generateUnits(companyId, lot._id, 4);
    await lotService.supplyTransfer({ companyId, sellerId, sourceWarehouseId: companyWh._id, destWarehouseId: sellerWh._id, items: [{ productId, quantity: 2 }], refId: new mongoose.Types.ObjectId(), performedBy });
  });
  const asSeller = (body = {}, params = {}, query = {}) => ({ user: { sellerId, principalType: "seller", role: "seller_admin" }, body, params, query });

  test("seller lists ONLY their own units", async () => {
    const res = mockRes();
    await sellerBarcode.listUnits(asSeller({}, {}, {}), res);
    expect(res.body.count).toBe(2);
    expect(res.body.data.every((u) => u.ownerType === "seller")).toBe(true);
  });

  test("seller can re-print their own units; cannot transition company units", async () => {
    const sellerSerials = (await UnitSerial.find({ ownerType: "seller", ownerId: sellerId })).map((u) => u.serial);
    const printRes = mockRes();
    await sellerBarcode.print(asSeller({ serials: sellerSerials }), printRes);
    expect(printRes.body.data.moved.length).toBe(2);

    // a company-owned serial is invisible to the seller print (scoped out)
    const companySerial = (await UnitSerial.findOne({ ownerType: "company", ownerId: companyId })).serial;
    const r2 = mockRes();
    await sellerBarcode.print(asSeller({ serials: [companySerial] }), r2);
    expect(r2.body.data.moved.length).toBe(0);
    const stillCompany = await UnitSerial.findOne({ serial: companySerial });
    expect(stillCompany.ownerType).toBe("company");
  });

  test("seller can scan a unit they own; a company-only unit is not found for them", async () => {
    const sellerSerial = (await UnitSerial.findOne({ ownerType: "seller", ownerId: sellerId })).serial;
    const ok = mockRes();
    await sellerBarcode.scan(asSeller({ code: sellerSerial }), ok);
    expect(ok.body.data.type).toBe("unit");

    const companySerial = (await UnitSerial.findOne({ ownerType: "company", ownerId: companyId })).serial;
    const miss = mockRes();
    await sellerBarcode.scan(asSeller({ code: companySerial }), miss);
    expect(miss.statusCode).toBe(404);
  });

  test("sellers cannot mint serials (generateUnits rejects a seller owner)", async () => {
    await expect(svc.generateUnits({ ownerType: "seller", ownerId: sellerId }, lot._id, 1)).rejects.toMatchObject({ status: 403 });
  });
});

describe("trace + recall reach seller-held units", () => {
  beforeEach(async () => {
    await svc.generateUnits(companyId, lot._id, 3);
    await lotService.supplyTransfer({ companyId, sellerId, sourceWarehouseId: companyWh._id, destWarehouseId: sellerWh._id, items: [{ productId, quantity: 2 }], refId: new mongoose.Types.ObjectId(), performedBy });
  });

  test("originating company sees a transferred unit's full-chain history", async () => {
    const sellerUnit = await UnitSerial.findOne({ ownerType: "seller", ownerId: sellerId });
    const { unit, events } = await svc.unitHistory({ ownerType: "company", ownerId: companyId }, sellerUnit.serial);
    expect(unit.serial).toBe(sellerUnit.serial);
    expect(events.some((e) => e.event === "supplied_to_seller")).toBe(true);
  });

  test("a company recall by lot reaches units now held by the seller", async () => {
    const r = await svc.recall(companyId, "L1", { performedBy });
    expect(r.recalledUnits).toBe(3); // all 3 labeled units (2 at seller, 1 at company)
    const sellerRecalled = await UnitSerial.find({ ownerType: "seller", ownerId: sellerId });
    expect(sellerRecalled.every((u) => u.status === "recalled")).toBe(true);
  });
});
