const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Adjustment = require("../model/Inventory/Adjustment");
const cycleCountService = require("../services/cycleCountService");
const { sellFEFO } = require("../services/lotService");

let companyId, warehouseId, productId;

beforeEach(async () => {
  const c = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = c._id;
  const wh = await Warehouse.create({ companyId, name: "Main", code: "WH1" });
  warehouseId = wh._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "U1", category: "Fertilizers" });
  productId = p._id;
});

async function seedLot(qty, expiryInDays = 100) {
  return Inventory.create({
    productId, ownerType: "company", ownerId: companyId, warehouseId,
    batchNumber: "B1", lotNumber: "B1",
    expiryDate: new Date(Date.now() + expiryInDays * 86400000),
    offlineStock: qty, availableStock: qty,
  });
}

describe("cycle count → variance → adjustment", () => {
  test("generate snapshots systemQty; complete creates one pending adjustment per variance", async () => {
    await seedLot(100);
    const cc = await cycleCountService.generateCount(companyId, { warehouseId, type: "cycle" });
    expect(cc.lines).toHaveLength(1);
    expect(cc.lines[0].systemQty).toBe(100); // snapshot

    await cycleCountService.submitCount(companyId, cc._id, { lines: [{ index: 0, countedQty: 94 }] });
    const { adjustmentsCreated } = await cycleCountService.completeCount(companyId, cc._id, {});
    expect(adjustmentsCreated).toBe(1);

    const adj = await Adjustment.findOne({ companyId, cycleCountId: cc._id });
    expect(adj.qtyDelta).toBe(-6); // 94 − 100
    expect(adj.reason).toBe("count_variance");
    expect(adj.status).toBe("pending"); // not auto-applied — needs approval

    // stock unchanged until the adjustment is approved
    const row = await Inventory.findOne({ ownerId: companyId, productId });
    expect(row.availableStock).toBe(100);
  });

  test("no variance → no adjustment", async () => {
    await seedLot(50);
    const cc = await cycleCountService.generateCount(companyId, { warehouseId });
    await cycleCountService.submitCount(companyId, cc._id, { lines: [{ index: 0, countedQty: 50 }] });
    const { adjustmentsCreated } = await cycleCountService.completeCount(companyId, cc._id, {});
    expect(adjustmentsCreated).toBe(0);
  });
});

describe("audit freeze blocks outward operations", () => {
  test("a full-audit freeze blocks sellFEFO from that warehouse", async () => {
    await seedLot(100);
    // open a freezing full audit
    await cycleCountService.generateCount(companyId, { warehouseId, type: "full_audit", freeze: true });

    await expect(sellFEFO({ ownerId: companyId, productId, qty: 10, channel: "offline" }))
      .rejects.toMatchObject({ status: 409 });

    // stock untouched
    const row = await Inventory.findOne({ ownerId: companyId, productId });
    expect(row.availableStock).toBe(100);
  });

  test("selling resumes once the audit is completed (freeze lifted)", async () => {
    await seedLot(100);
    const cc = await cycleCountService.generateCount(companyId, { warehouseId, type: "full_audit", freeze: true });
    await cycleCountService.completeCount(companyId, cc._id, {});

    const consumed = await sellFEFO({ ownerId: companyId, productId, qty: 10, channel: "offline" });
    expect(consumed[0].qty).toBe(10);
  });
});
