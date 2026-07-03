const mongoose = require("mongoose");
const Product = require("../model/Company/productModel");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const { classifyABC } = require("../services/abcService");

const companyId = new mongoose.Types.ObjectId();

async function product(name, mrp) {
  return Product.create({ companyId, productName: name, skuNumber: name, mrp });
}
async function inv(productId) {
  return Inventory.create({ productId, ownerType: "company", ownerId: companyId, batchNumber: "B", lotNumber: "B", offlineStock: 10, availableStock: 10 });
}
async function sale(productId, qty) {
  return StockMovement.create({
    inventoryId: new mongoose.Types.ObjectId(),
    productId, ownerType: "company", ownerId: companyId,
    type: "sale_offline", channel: "offline", quantity: -qty,
  });
}

describe("classifyABC()", () => {
  test("ranks products by 90-day outflow value into A/B/C and stamps Inventory", async () => {
    const hi = await product("HI", 1000); // high value mover
    const mid = await product("MID", 100);
    const lo = await product("LO", 10);
    const dead = await product("DEAD", 500); // no sales → C
    await Promise.all([inv(hi._id), inv(mid._id), inv(lo._id), inv(dead._id)]);

    await sale(hi._id, 100); // value 100000
    await sale(mid._id, 100); // value 10000
    await sale(lo._id, 100); // value 1000

    const counts = await classifyABC(companyId);
    expect(counts.A + counts.B + counts.C).toBe(4);

    const hiRow = await Inventory.findOne({ ownerId: companyId, productId: hi._id });
    const deadRow = await Inventory.findOne({ ownerId: companyId, productId: dead._id });
    expect(hiRow.abcClass).toBe("A"); // dominates the value
    expect(deadRow.abcClass).toBe("C"); // no movement
  });

  test("all-zero movement → everything is C", async () => {
    const p = await product("X", 100);
    await inv(p._id);
    await classifyABC(companyId);
    const row = await Inventory.findOne({ ownerId: companyId, productId: p._id });
    expect(row.abcClass).toBe("C");
  });
});
