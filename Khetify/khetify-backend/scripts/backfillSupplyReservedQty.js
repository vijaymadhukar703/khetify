/**
 * backfillSupplyReservedQty.js — one-off migration for the reserve-at-PICK change.
 *
 * Background: supply approval used to RESERVE stock (available → reserved).
 * Approval is now authorization only; stock is reserved when the warehouse PICKS,
 * tracked per lot in `items[].allocations[].reservedQty`, and dispatch commits
 * exactly that amount.
 *
 * In-flight orders approved under the OLD code already have their stock reserved
 * but carry reservedQty = 0, so dispatch would build no lines and their reserved
 * stock would be stranded. This sets reservedQty = qty on their (uncommitted)
 * allocations so they can dispatch normally.
 *
 * Touches ONLY SupplyOrder.items[].allocations[].reservedQty — it moves NO stock,
 * writes NO ledger row, and never touches committed (already dispatched)
 * allocations or orders that were never approved.
 *
 * Run ONCE, right after deploying the change, from the backend folder:
 *   node scripts/backfillSupplyReservedQty.js
 *
 * Safe to re-run: only allocations with reservedQty falsy are touched.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const SupplyOrder = require("../model/Supply/SupplyOrder");

// Orders that were approved under the old code and have NOT yet dispatched:
// their stock is reserved right now.
const PRE_DISPATCH = ["approved", "picking", "picked", "packing", "packed"];

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const orders = await SupplyOrder.find({ status: { $in: PRE_DISPATCH } });
    console.log(`🔎 ${orders.length} pre-dispatch supply order(s) to check.`);

    let touchedOrders = 0;
    let touchedAllocs = 0;
    for (const o of orders) {
      let changed = false;
      for (const it of o.items || []) {
        for (const a of it.allocations || []) {
          if (a.committed) continue;
          if (Number(a.reservedQty || 0) > 0) continue; // already migrated
          a.reservedQty = Number(a.qty || 0);
          if (a.reservedQty > 0) { changed = true; touchedAllocs++; }
        }
      }
      if (changed) {
        o.markModified("items");
        await o.save();
        touchedOrders++;
      }
    }
    console.log(`✅ Set reservedQty on ${touchedAllocs} allocation(s) across ${touchedOrders} order(s). No stock moved.`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillSupplyReservedQty failed:", err.message);
    process.exit(1);
  });
