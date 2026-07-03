const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Inventory = require("../model/Inventory/Inventory");
const Order = require("../model/Order/Order");
const Shipment = require("../model/Transport/Shipment");
const ShipmentCost = require("../model/Transport/ShipmentCost");
const ProductCost = require("../model/Costing/ProductCost");
const lotService = require("../services/lotService");
const costing = require("../services/costingService");
const { runReconciliation } = require("../services/reconciliationService");

let companyId, productId;
const finance = new mongoose.Types.ObjectId();
const owner = new mongoose.Types.ObjectId();

beforeEach(async () => {
  const c = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = c._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "U1", mrp: 100 });
  productId = p._id;
});

describe("reconciliation (ledger vs stock)", () => {
  test("flags a row whose ledger disagrees with stored stock; leaves a consistent one clean", async () => {
    // B1: built via ledger (supply_in 40 → stored 40), then stored is bumped
    // OUT of band (no movement) → ledger 40 vs stored 50 → mismatch.
    await lotService.receiveLot({ ownerId: companyId, productId, batchNumber: "B1", qty: 40, unitCost: 10 });
    await Inventory.updateOne({ ownerId: companyId, batchNumber: "B1" }, { $inc: { offlineStock: 10, availableStock: 10 } });
    // B2: clean — ledger 25 == stored 25.
    await lotService.receiveLot({ ownerId: companyId, productId, batchNumber: "B2", qty: 25, unitCost: 10 });

    const r = await runReconciliation(companyId);
    const kinds = r.mismatches.map((m) => `${m.lotNumber}:${m.kind}`);
    expect(kinds).toContain("B1:LEDGER_VS_STOCK"); // 50 stored vs 40 ledger
    expect(kinds).not.toContain("B2:LEDGER_VS_STOCK");
    const b1 = r.mismatches.find((m) => m.lotNumber === "B1");
    expect(b1.diff).toBe(10);
  });
});

describe("costing approval matrix + profitability", () => {
  test("requester cannot approve their own cost change; owner can", async () => {
    await costing.requestCostChange({ user: { companyId, id: finance }, productId, change: { productionCost: 30, packagingCost: 10, sellingPrice: 100 } });

    await expect(
      costing.approveCostChange({ user: { companyId, id: finance }, productId, approve: true })
    ).rejects.toMatchObject({ status: 403 });

    const doc = await costing.approveCostChange({ user: { companyId, id: owner }, productId, approve: true });
    expect(doc.totalCost).toBe(40); // 30 + 10
    expect(doc.pendingChange).toBeNull();
  });

  test("profitability = revenue − (cost × units)", async () => {
    // approve a cost of 40/unit
    await costing.requestCostChange({ user: { companyId, id: finance }, productId, change: { productionCost: 40, sellingPrice: 100 } });
    await costing.approveCostChange({ user: { companyId, id: owner }, productId, approve: true });
    // a delivered order: 10 units @ 100
    await Order.create({ companyId, invoiceNumber: "INV-1", status: "delivered", placedAt: new Date(), items: [{ productId, name: "Urea", qty: 10, price: 100 }], totalAmount: 1000 });

    const rows = await costing.productProfitability({ companyId });
    const row = rows.find((r) => String(r.productId) === String(productId));
    expect(row.revenue).toBe(1000);
    expect(row.cost).toBe(400); // 40 × 10
    expect(row.profit).toBe(600);
    expect(row.marginPct).toBe(60);
  });
});

describe("shipment cost auto-totals", () => {
  test("totalCost sums components and costPerUnit divides by units", async () => {
    const shp = await Shipment.create({ companyId, toLabel: "X", status: "in_transit" });
    const sc = await ShipmentCost.create({ companyId, shipmentId: shp._id, fuelCost: 500, driverCost: 300, tollCost: 200, unitsShipped: 100 });
    expect(sc.totalCost).toBe(1000);
    expect(sc.costPerUnit).toBe(10);

    const a = await costing.transportAnalytics({ companyId });
    expect(a.totalCost).toBe(1000);
    expect(a.avgCostPerUnit).toBe(10);
  });
});
