const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Customer = require("../model/Sales/Customer");
const Inventory = require("../model/Inventory/Inventory");
const salesService = require("../services/salesService");
const lotService = require("../services/lotService");
const tax = require("../services/taxService");

let companyId;
beforeEach(async () => {
  const c = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = c._id;
});

describe("invoice numbering", () => {
  test("gapless + unique under concurrency (50 parallel allocations)", async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => salesService.nextInvoiceNumber(companyId)));
    const seqs = results.map((s) => Number(s.split("-")[2]));
    const unique = new Set(seqs);
    expect(unique.size).toBe(50); // no duplicates
    expect(Math.min(...seqs)).toBe(1);
    expect(Math.max(...seqs)).toBe(50); // contiguous 1..50 — no gaps
  });
});

describe("GST tax computation", () => {
  test("intra-state → CGST + SGST, no IGST", async () => {
    const t = tax.computeLineTax({ taxable: 1000, gstRate: 18, companyStateCode: "23", customerStateCode: "23" });
    expect(t.cgst).toBe(90);
    expect(t.sgst).toBe(90);
    expect(t.igst).toBe(0);
  });
  test("inter-state → IGST, no CGST/SGST", async () => {
    const t = tax.computeLineTax({ taxable: 1000, gstRate: 18, companyStateCode: "23", customerStateCode: "27" });
    expect(t.igst).toBe(180);
    expect(t.cgst).toBe(0);
    expect(t.sgst).toBe(0);
  });
  test("unknown customer state defaults to intra-state", async () => {
    const t = tax.computeLineTax({ taxable: 1000, gstRate: 18, companyStateCode: "23", customerStateCode: null });
    expect(t.cgst).toBe(90);
    expect(t.igst).toBe(0);
  });
});

describe("FEFO allocate / commit / release", () => {
  async function seedLot(batch, qty, expiryDays) {
    const p = await Product.create({ companyId, productName: "X", skuNumber: batch, mrp: 100 });
    await Inventory.create({ productId: p._id, ownerType: "company", ownerId: companyId, batchNumber: batch, lotNumber: batch, expiryDate: new Date(Date.now() + expiryDays * 86400000), offlineStock: qty, availableStock: qty });
    return p._id;
  }

  test("allocate reserves available→reserved and records lot allocations", async () => {
    const productId = await seedLot("B1", 100, 30);
    const allocs = await lotService.allocateFEFO({ ownerId: companyId, productId, qty: 40 });
    expect(allocs).toHaveLength(1);
    expect(allocs[0].qty).toBe(40);

    const inv = await Inventory.findOne({ ownerId: companyId, productId });
    expect(inv.reservedStock).toBe(40);
    expect(inv.availableStock).toBe(60); // 100 − 40 reserved
  });

  test("commit moves reserved→sold (out of offline bucket)", async () => {
    const productId = await seedLot("B2", 50, 30);
    const allocs = await lotService.allocateFEFO({ ownerId: companyId, productId, qty: 20 });
    await lotService.commitAllocation({ ownerId: companyId, allocations: allocs, channel: "offline" });

    const inv = await Inventory.findOne({ ownerId: companyId, productId });
    expect(inv.reservedStock).toBe(0);
    expect(inv.offlineStock).toBe(30); // 50 − 20 dispatched
    expect(inv.availableStock).toBe(30);
    expect(allocs[0].committed).toBe(true);
  });

  test("release returns reserved→available", async () => {
    const productId = await seedLot("B3", 50, 30);
    const allocs = await lotService.allocateFEFO({ ownerId: companyId, productId, qty: 15 });
    await lotService.releaseAllocation({ ownerId: companyId, allocations: allocs });

    const inv = await Inventory.findOne({ ownerId: companyId, productId });
    expect(inv.reservedStock).toBe(0);
    expect(inv.availableStock).toBe(50); // fully restored
  });

  test("allocate spans lots earliest-expiry first", async () => {
    const p = await Product.create({ companyId, productName: "Y", skuNumber: "Y", mrp: 10 });
    await Inventory.create({ productId: p._id, ownerType: "company", ownerId: companyId, batchNumber: "LATE", lotNumber: "LATE", expiryDate: new Date(Date.now() + 90 * 86400000), offlineStock: 10, availableStock: 10 });
    await Inventory.create({ productId: p._id, ownerType: "company", ownerId: companyId, batchNumber: "SOON", lotNumber: "SOON", expiryDate: new Date(Date.now() + 10 * 86400000), offlineStock: 10, availableStock: 10 });
    const allocs = await lotService.allocateFEFO({ ownerId: companyId, productId: p._id, qty: 15 });
    expect(allocs[0].lotNumber).toBe("SOON");
    expect(allocs[0].qty).toBe(10);
    expect(allocs[1].lotNumber).toBe("LATE");
    expect(allocs[1].qty).toBe(5);
  });
});
