/**
 * diagnoseSerialPick.js — READ-ONLY diagnosis for the Send-Stock pick error
 * "Serial <X> is not from this order's reserved lots".
 *
 * It prints, for a given unit serial:
 *   - the unit's parent lot (inventoryId), lot number, product, warehouse, status
 *   - every pickable Supply Order / customer Order for that product+company and
 *     the lot IDs each one has RESERVED (item.allocations[].inventoryId)
 *   - whether the unit's lot is present in each order's reserved allocations
 *
 * This reveals the real cause: the pick validates the scanned unit's lot (by ID)
 * against the order's FEFO-RESERVED lots. If FEFO reserved a different lot (or a
 * different source warehouse was assigned), a valid unit is correctly rejected.
 *
 * Writes NOTHING. Run from the backend folder (needs .env with MONGO_URI):
 *   node scripts/diagnoseSerialPick.js KHJBL2026070015-001
 */

require("dotenv").config();
const mongoose = require("mongoose");

const UnitSerial = require("../model/Barcode/UnitSerial");
const Inventory = require("../model/Inventory/Inventory");
const SupplyOrder = require("../model/Supply/SupplyOrder");
const Order = require("../model/Order/Order");
const Warehouse = require("../model/Warehouse/Warehouse");

const idStr = (v) => (v == null ? "—" : String(v._id || v));

async function whName(id) {
  if (!id) return "—";
  const w = await Warehouse.findById(id).select("name").lean();
  return w ? `${w.name} (${idStr(id)})` : idStr(id);
}

async function reportOrder(kind, o, item, unitLotId, unitWarehouseId) {
  const allocs = item.allocations || [];
  const reservedIds = allocs.map((a) => String(a.inventoryId));
  const inReserved = reservedIds.includes(String(unitLotId));
  console.log(`\n  • ${kind} ${o._id} — status "${o.status}", source warehouse ${await whName(o.sourceWarehouseId)}`);
  if (!allocs.length) {
    console.log(`      reserved allocations: NONE (order not yet reserved/approved)`);
  } else {
    for (const a of allocs) {
      console.log(`      reserved lot: inventoryId=${String(a.inventoryId)} lot=${a.lotNumber || a.batchNumber || "—"} warehouse=${await whName(a.warehouseId)} qty=${a.qty} serials=${(a.serials || []).length}`);
    }
  }
  console.log(`      → unit lot ${inReserved ? "IS" : "is NOT"} among this order's reserved lots ${inReserved ? "✅ (would pick)" : "❌ (rejected here)"}`);
}

async function main() {
  const serial = (process.argv[2] || "").trim();
  if (!serial) throw new Error("Usage: node scripts/diagnoseSerialPick.js <UNIT_SERIAL>");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const unit = await UnitSerial.findOne({ serial }).lean();
    if (!unit) { console.log(`❌ No unit serial "${serial}" found.`); return; }

    const lot = unit.inventoryId ? await Inventory.findById(unit.inventoryId).lean() : null;
    console.log("================ UNIT ================");
    console.log(`serial          : ${unit.serial}`);
    console.log(`parent lot (inventoryId): ${idStr(unit.inventoryId)}`);
    console.log(`lotNumber       : ${unit.lotNumber || "—"}`);
    console.log(`productId       : ${idStr(unit.productId)}`);
    console.log(`status          : ${unit.status}   printed: ${unit.printed === true}`);
    console.log(`owner           : ${unit.ownerType}/${idStr(unit.ownerId)}`);
    console.log(`lot warehouse   : ${await whName(lot && lot.warehouseId)}`);
    console.log(`lot availableStock: ${lot ? lot.availableStock : "—"}`);

    console.log("\n=========== ORDERS THAT COULD BE PICKED (same product & company) ===========");
    const q = { companyId: unit.companyId, "items.productId": unit.productId };
    const supplies = await SupplyOrder.find({ ...q, status: { $in: ["approved", "picking"] } }).lean();
    const orders = await Order.find({ ...q, status: { $in: ["confirmed", "packed", "picking"] } }).lean();

    if (!supplies.length && !orders.length) {
      console.log("  (none in a pickable state — the transfer/order may not be approved/reserved yet)");
    }
    for (const o of supplies) {
      const item = (o.items || []).find((it) => String(it.productId) === String(unit.productId));
      if (item) await reportOrder("SupplyOrder", o, item, unit.inventoryId, lot && lot.warehouseId);
    }
    for (const o of orders) {
      const item = (o.items || []).find((it) => String(it.productId) === String(unit.productId));
      if (item) await reportOrder("Order", o, item, unit.inventoryId, lot && lot.warehouseId);
    }

    console.log("\n================ VERDICT ================");
    console.log("If the unit's lot is NOT among any order's reserved lots, the pick correctly");
    console.log("rejected it: FEFO reserved a different lot (or a different source warehouse).");
    console.log("To send THIS specific lot, use the warehouse→warehouse Transfer flow (lot-specific),");
    console.log("or reserve this lot explicitly. The ID comparison itself is working correctly.");
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ diagnoseSerialPick failed:", err.message);
    process.exit(1);
  });
