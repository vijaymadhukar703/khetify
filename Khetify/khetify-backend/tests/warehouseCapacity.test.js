const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const lotService = require("../services/lotService");
const adjustmentService = require("../services/adjustmentService");
const { warehouseOccupancy, assertWarehouseCapacity } = require("../services/warehouseCapacityService");

let companyId, productId;

beforeEach(async () => {
  const company = await Company.create({ fullName: "Cap Co", email: `cap-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = company._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR" });
  productId = p._id;
});

describe("receiveLot() respects warehouse capacity", () => {
  test("blocks a lot that would overflow a capped warehouse", async () => {
    const wh = await Warehouse.create({ companyId, name: "jabalpur", code: "JBL", capacityUnits: 20000 });
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: wh._id, qty: 20000, batchNumber: "L1" });
    // any further stock-in must be rejected — warehouse is full
    await expect(
      lotService.receiveLot({ ownerId: companyId, productId, warehouseId: wh._id, qty: 500, batchNumber: "L2" }),
    ).rejects.toMatchObject({ status: 409 });
    // the overflow lot was NOT persisted
    expect(await Inventory.findOne({ ownerId: companyId, warehouseId: wh._id, batchNumber: "L2" })).toBeNull();
    // occupancy stayed at the cap
    expect(await warehouseOccupancy({ ownerId: companyId, warehouseId: wh._id })).toBe(20000);
  });

  test("error message states the available space", async () => {
    const wh = await Warehouse.create({ companyId, name: "jabalpur", code: "JBL", capacityUnits: 20000 });
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: wh._id, qty: 15000, batchNumber: "L1" });
    await expect(
      lotService.receiveLot({ ownerId: companyId, productId, warehouseId: wh._id, qty: 10000, batchNumber: "L2" }),
    ).rejects.toThrow(/Only 5000 units space is available in this warehouse/);
  });

  test("allows filling exactly to capacity", async () => {
    const wh = await Warehouse.create({ companyId, name: "jabalpur", code: "JBL", capacityUnits: 100 });
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: wh._id, qty: 60, batchNumber: "L1" });
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: wh._id, qty: 40, batchNumber: "L2" });
    expect(await warehouseOccupancy({ ownerId: companyId, warehouseId: wh._id })).toBe(100);
  });

  test("a warehouse with no capacity set is uncapped", async () => {
    const wh = await Warehouse.create({ companyId, name: "open", code: "OPN" });
    const inv = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: wh._id, qty: 999999, batchNumber: "L1" });
    expect(inv.availableStock).toBe(999999);
  });
});

describe("transferLot() respects the destination warehouse capacity", () => {
  test("blocks a transfer that would overflow the destination", async () => {
    const src = await Warehouse.create({ companyId, name: "src", code: "SRC" }); // uncapped
    const dest = await Warehouse.create({ companyId, name: "dest", code: "DST", capacityUnits: 100 });
    const inv = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: src._id, qty: 500, batchNumber: "L1" });
    // fill dest to 80
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: dest._id, qty: 80, batchNumber: "L2" });
    // transferring 40 more would make 120 > 100 → rejected
    await expect(
      lotService.transferLot({ inventoryId: inv._id, toWarehouseId: dest._id, qty: 40 }),
    ).rejects.toMatchObject({ status: 409 });
    // source stock untouched (transaction rolled back)
    const srcAfter = await Inventory.findById(inv._id);
    expect(srcAfter.availableStock).toBe(500);
  });
});

describe("adjustment increase respects warehouse capacity", () => {
  test("blocks a positive adjustment that would overflow the warehouse", async () => {
    const wh = await Warehouse.create({ companyId, name: "jabalpur", code: "JBL", capacityUnits: 100 });
    const inv = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: wh._id, qty: 100, batchNumber: "L1" });
    const requester = new mongoose.Types.ObjectId();
    const approver = new mongoose.Types.ObjectId();
    const adj = await adjustmentService.createAdjustment(companyId, { inventoryId: inv._id, qtyDelta: 50, reason: "count_variance", requestedBy: requester });
    await expect(
      adjustmentService.approveAdjustment(companyId, adj._id, { approverId: approver }),
    ).rejects.toMatchObject({ status: 409 });
    // stock unchanged
    expect((await Inventory.findById(inv._id)).availableStock).toBe(100);
  });

  test("a negative adjustment is unaffected by the cap", async () => {
    const wh = await Warehouse.create({ companyId, name: "jabalpur", code: "JBL", capacityUnits: 100 });
    const inv = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: wh._id, qty: 100, batchNumber: "L1" });
    const adj = await adjustmentService.createAdjustment(companyId, { inventoryId: inv._id, qtyDelta: -30, reason: "damage", requestedBy: new mongoose.Types.ObjectId() });
    await adjustmentService.approveAdjustment(companyId, adj._id, { approverId: new mongoose.Types.ObjectId() });
    expect((await Inventory.findById(inv._id)).availableStock).toBe(70);
  });
});

describe("assertWarehouseCapacity() over-capacity from legacy data", () => {
  test("occupancy already above capacity blocks any further add", async () => {
    const wh = await Warehouse.create({ companyId, name: "jabalpur", code: "JBL", capacityUnits: 20000 });
    // simulate legacy over-capacity data directly
    await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: wh._id, batchNumber: "OLD", availableStock: 40500, offlineStock: 40500 });
    expect(await warehouseOccupancy({ ownerId: companyId, warehouseId: wh._id })).toBe(40500);
    await expect(
      assertWarehouseCapacity({ ownerId: companyId, warehouseId: wh._id, addQty: 1 }),
    ).rejects.toThrow(/Warehouse capacity is full\. Available space is 0 units/);
  });
});
