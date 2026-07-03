const mongoose = require("mongoose");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const { sellFEFO } = require("../services/lotService");

const ownerId = new mongoose.Types.ObjectId();
const productId = new mongoose.Types.ObjectId();

async function seedLot({ batchNumber, expiryDate, qty }) {
  return Inventory.create({
    productId,
    ownerType: "company",
    ownerId,
    batchNumber,
    lotNumber: batchNumber,
    expiryDate,
    offlineStock: qty,
    availableStock: qty,
  });
}

const day = 86400000;
const soon = new Date(Date.now() + 10 * day);
const later = new Date(Date.now() + 60 * day);
const expired = new Date(Date.now() - 5 * day);

describe("sellFEFO()", () => {
  test("consumes earliest-expiry lot first (FEFO order)", async () => {
    await seedLot({ batchNumber: "LATER", expiryDate: later, qty: 10 });
    await seedLot({ batchNumber: "SOON", expiryDate: soon, qty: 10 });

    const consumed = await sellFEFO({ ownerId, productId, qty: 6, channel: "offline" });

    expect(consumed).toHaveLength(1);
    expect(consumed[0].lotNumber).toBe("SOON"); // earliest expiry drained first
    expect(consumed[0].qty).toBe(6);

    const soonRow = await Inventory.findOne({ ownerId, batchNumber: "SOON" });
    const laterRow = await Inventory.findOne({ ownerId, batchNumber: "LATER" });
    expect(soonRow.availableStock).toBe(4);
    expect(laterRow.availableStock).toBe(10); // untouched
  });

  test("spills across lots when the first cannot cover the quantity", async () => {
    await seedLot({ batchNumber: "SOON", expiryDate: soon, qty: 5 });
    await seedLot({ batchNumber: "LATER", expiryDate: later, qty: 10 });

    const consumed = await sellFEFO({ ownerId, productId, qty: 8, channel: "offline" });

    expect(consumed.map((c) => [c.lotNumber, c.qty])).toEqual([
      ["SOON", 5],
      ["LATER", 3],
    ]);
  });

  test("never picks expired lots", async () => {
    await seedLot({ batchNumber: "EXPIRED", expiryDate: expired, qty: 50 });
    await seedLot({ batchNumber: "GOOD", expiryDate: soon, qty: 10 });

    const consumed = await sellFEFO({ ownerId, productId, qty: 10 });
    expect(consumed.every((c) => c.lotNumber !== "EXPIRED")).toBe(true);

    const expiredRow = await Inventory.findOne({ ownerId, batchNumber: "EXPIRED" });
    expect(expiredRow.availableStock).toBe(50); // expired stock left alone
  });

  test("throws 409 INSUFFICIENT_STOCK when non-expired stock cannot cover qty", async () => {
    await seedLot({ batchNumber: "GOOD", expiryDate: soon, qty: 3 });
    await seedLot({ batchNumber: "EXPIRED", expiryDate: expired, qty: 100 });

    await expect(sellFEFO({ ownerId, productId, qty: 10 })).rejects.toMatchObject({
      status: 409,
    });
    // nothing should have been deducted
    const good = await Inventory.findOne({ ownerId, batchNumber: "GOOD" });
    expect(good.availableStock).toBe(3);
  });

  test("writes exactly one StockMovement ledger row per lot consumed", async () => {
    await seedLot({ batchNumber: "SOON", expiryDate: soon, qty: 5 });
    await seedLot({ batchNumber: "LATER", expiryDate: later, qty: 10 });

    await sellFEFO({ ownerId, productId, qty: 8, channel: "offline" });

    const rows = await StockMovement.find({ productId, type: "sale_offline" }).sort({ createdAt: 1 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.quantity)).toEqual([-5, -3]); // signed out-moves
    expect(rows.every((r) => r.refType === "Order")).toBe(true);
  });
});
