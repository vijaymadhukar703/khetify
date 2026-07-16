/**
 * backfillUnitWarehouseStatus.js — safe reconciliation for unit serials that
 * were generated BEFORE the parent-lot warehouse-assignment fix.
 *
 * Problem it fixes: serials minted for a lot that is already assigned to a
 * warehouse were left in status "generated" (awaiting a putaway that the
 * direct Create-Lot flow never performs), so the warehouse could not treat
 * them as available/pickable stock.
 *
 * What it does: for every UnitSerial still in status "generated" whose parent
 * lot (inventoryId) IS assigned to a warehouse (Inventory.warehouseId set), it
 * flips the unit to "in_stock" (this model's available/pickable state). The
 * unit is already tied to the warehouse via inventoryId, so NO warehouse field
 * is added and NO stock quantity is changed — these are tracking records over
 * the lot's existing quantity.
 *
 * It deliberately does NOT touch:
 *   - units in any other status (printed / in_stock / picked / shipped / …)
 *   - units whose lot has no warehouse (warehouseId === null) — they still
 *     belong in the putaway flow
 *   - any Inventory quantity, StockMovement ledger row, or shipment
 *
 * Run ONCE from the backend folder (needs your normal .env with MONGO_URI):
 *   node scripts/backfillUnitWarehouseStatus.js
 *
 * Safe to re-run: only "generated" units on warehoused lots are touched, so a
 * second run reports 0.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const Inventory = require("../model/Inventory/Inventory");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    // Parent lots that are assigned to a warehouse — their on-hand stock is
    // physically present, so serials for them should be available.
    const warehousedLotIds = await Inventory.find({ warehouseId: { $ne: null } }).distinct("_id");
    console.log(`🔎 ${warehousedLotIds.length} warehoused lot(s) found.`);

    const filter = { inventoryId: { $in: warehousedLotIds }, status: "generated" };
    const targets = await UnitSerial.find(filter).select("_id serial companyId status").lean();
    console.log(`🔎 ${targets.length} generated unit serial(s) on warehoused lots to reconcile.`);

    if (targets.length) {
      const res = await UnitSerial.updateMany(filter, { $set: { status: "in_stock" } });
      console.log(`✅ Moved ${res.modifiedCount} unit(s) "generated" → "in_stock" (no stock quantity changed).`);

      // Trace: one availability event per reconciled unit.
      await UnitEvent.insertMany(
        targets.map((u) => ({
          companyId: u.companyId,
          serial: u.serial,
          event: "in_stock",
          fromStatus: "generated",
          toStatus: "in_stock",
          refType: "Reconcile",
        })),
        { ordered: false }
      );
      console.log(`🧾 Wrote ${targets.length} trace event(s).`);
    }
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillUnitWarehouseStatus failed:", err.message);
    process.exit(1);
  });
