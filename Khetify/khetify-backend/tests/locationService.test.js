const mongoose = require("mongoose");
const Warehouse = require("../model/Warehouse/Warehouse");
const Location = require("../model/Warehouse/Location");
const Inventory = require("../model/Inventory/Inventory");
const InventoryBin = require("../model/Inventory/InventoryBin");
const StockMovement = require("../model/Inventory/StockMovement");
const svc = require("../services/locationService");

const companyId = new mongoose.Types.ObjectId();

async function makeWarehouse(code = "WH1") {
  return Warehouse.create({ companyId, name: "Main", code });
}

async function makeInventory(warehouseId, qty) {
  return Inventory.create({
    productId: new mongoose.Types.ObjectId(),
    ownerType: "company",
    ownerId: companyId,
    warehouseId,
    batchNumber: "B1",
    lotNumber: "B1",
    offlineStock: qty,
    availableStock: qty,
  });
}

describe("createLocation() fullCode building", () => {
  test("derives fullCode from warehouse prefix + ancestor codes", async () => {
    const wh = await makeWarehouse("WH1");
    const zone = await svc.createLocation(companyId, { warehouseId: wh._id, type: "zone", code: "A" });
    expect(zone.fullCode).toBe("WH1-A");

    const rack = await svc.createLocation(companyId, { warehouseId: wh._id, parentId: zone._id, type: "rack", code: "R03" });
    expect(rack.fullCode).toBe("WH1-A-R03");

    const bin = await svc.createLocation(companyId, { warehouseId: wh._id, parentId: rack._id, type: "bin", code: "B07" });
    expect(bin.fullCode).toBe("WH1-A-R03-B07");
    expect(bin.barcode).toBe(bin.fullCode); // barcode mirrors fullCode
  });

  test("rejects a duplicate fullCode in the same warehouse", async () => {
    const wh = await makeWarehouse("WH1");
    await svc.createLocation(companyId, { warehouseId: wh._id, type: "zone", code: "A" });
    await expect(
      svc.createLocation(companyId, { warehouseId: wh._id, type: "zone", code: "A" })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("generateTree()", () => {
  test("creates the full zone/rack/shelf/bin tree with correct counts", async () => {
    const wh = await makeWarehouse("WH2");
    const result = await svc.generateTree(companyId, {
      warehouseId: wh._id,
      zones: 2,
      racksPerZone: 2,
      shelvesPerRack: 2,
      binsPerShelf: 3,
    });
    expect(result.bins).toBe(2 * 2 * 2 * 3); // 24 bins
    expect(result.created).toBe(2 + 4 + 8 + 24); // zones+racks+shelves+bins

    const bins = await Location.find({ warehouseId: wh._id, type: "bin" });
    expect(bins).toHaveLength(24);
    // sample address shape
    expect(bins.every((b) => /^WH2-[A-Z]-R\d{2}-S\d-B\d{2}$/.test(b.fullCode))).toBe(true);
  });

  test("refuses absurdly large generation", async () => {
    const wh = await makeWarehouse("WH3");
    await expect(
      svc.generateTree(companyId, { warehouseId: wh._id, zones: 50, racksPerZone: 50, shelvesPerRack: 50, binsPerShelf: 50 })
    ).rejects.toThrow(/limit/i);
  });
});

describe("moveBinStock() + bin-sum invariant", () => {
  test("putaway from pool then bin→bin relocation keeps the sum constant", async () => {
    const wh = await makeWarehouse("WH4");
    const inv = await makeInventory(wh._id, 100);
    const A = await svc.createLocation(companyId, { warehouseId: wh._id, type: "bin", code: "A1" });
    const B = await svc.createLocation(companyId, { warehouseId: wh._id, type: "bin", code: "B1" });

    // pool → A (putaway)
    await svc.moveBinStock({ companyId, toLocationId: A._id, inventoryId: inv._id, qty: 60 });
    expect(await svc.binnedQty(inv._id)).toBe(60);

    // A → B (relocation) keeps the total binned the same
    await svc.moveBinStock({ companyId, fromLocationId: A._id, toLocationId: B._id, inventoryId: inv._id, qty: 25 });
    expect(await svc.binnedQty(inv._id)).toBe(60);

    const aBin = await InventoryBin.findOne({ inventoryId: inv._id, locationId: A._id });
    const bBin = await InventoryBin.findOne({ inventoryId: inv._id, locationId: B._id });
    expect(aBin.qty).toBe(35);
    expect(bBin.qty).toBe(25);
  });

  test("cannot put away more than the unbinned pool holds (invariant guard)", async () => {
    const wh = await makeWarehouse("WH5");
    const inv = await makeInventory(wh._id, 10);
    const A = await svc.createLocation(companyId, { warehouseId: wh._id, type: "bin", code: "A1" });

    await svc.moveBinStock({ companyId, toLocationId: A._id, inventoryId: inv._id, qty: 10 });
    // pool now empty — any further putaway must fail and not exceed total
    await expect(
      svc.moveBinStock({ companyId, toLocationId: A._id, inventoryId: inv._id, qty: 1 })
    ).rejects.toMatchObject({ status: 409 });
    expect(await svc.binnedQty(inv._id)).toBe(10); // never exceeds onlineStock+offlineStock
  });

  test("bin→bin move rolls back fully when source lacks stock", async () => {
    const wh = await makeWarehouse("WH6");
    const inv = await makeInventory(wh._id, 50);
    const A = await svc.createLocation(companyId, { warehouseId: wh._id, type: "bin", code: "A1" });
    const B = await svc.createLocation(companyId, { warehouseId: wh._id, type: "bin", code: "B1" });
    await svc.moveBinStock({ companyId, toLocationId: A._id, inventoryId: inv._id, qty: 5 });

    await expect(
      svc.moveBinStock({ companyId, fromLocationId: A._id, toLocationId: B._id, inventoryId: inv._id, qty: 20 })
    ).rejects.toMatchObject({ status: 409 });

    const aBin = await InventoryBin.findOne({ inventoryId: inv._id, locationId: A._id });
    const bBin = await InventoryBin.findOne({ inventoryId: inv._id, locationId: B._id });
    expect(aBin.qty).toBe(5); // unchanged
    expect(bBin).toBeNull(); // destination never created
  });

  test("writes a bin_move ledger row per successful move", async () => {
    const wh = await makeWarehouse("WH7");
    const inv = await makeInventory(wh._id, 30);
    const A = await svc.createLocation(companyId, { warehouseId: wh._id, type: "bin", code: "A1" });
    await svc.moveBinStock({ companyId, toLocationId: A._id, inventoryId: inv._id, qty: 30 });

    const rows = await StockMovement.find({ inventoryId: inv._id, type: "bin_move" });
    expect(rows).toHaveLength(1);
    expect(rows[0].refType).toBe("BinMove");
  });
});
