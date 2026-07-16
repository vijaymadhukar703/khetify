/**
 * backfillUnitPrinted.js — one-off migration that sets the new `printed` flag on
 * existing UnitSerial rows from their real print HISTORY.
 *
 * Why: label print-state used to be inferred from the stock `status`
 * ("generated" == not printed). That broke once serials could be minted
 * straight into "in_stock" at a warehouse. Print-state now lives in a dedicated
 * `printed` boolean set only by markPrinted(). This backfill marks
 * `printed: true` for exactly the units that were actually printed before —
 * i.e. those with a "printed" UnitEvent — and leaves everything else false.
 *
 * Accuracy: a unit that reached "in_stock/picked/…" via the OLD flow has a
 * "printed" event → printed:true (its old print status is preserved). A unit
 * minted DIRECTLY into "in_stock" (new warehouse-assignment flow, never printed)
 * has NO "printed" event → stays printed:false, so it correctly shows under
 * "Unprinted only".
 *
 * Touches ONLY the `printed`/`printedAt` flags. No stock quantity, no status,
 * no warehouse/ownership. Safe to re-run.
 *
 * Run from the backend folder (needs .env with MONGO_URI):
 *   node scripts/backfillUnitPrinted.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");

const CHUNK = 5000;

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    // Serials that were actually printed at least once.
    const printedSerials = await UnitEvent.distinct("serial", { event: "printed" });
    console.log(`🔎 ${printedSerials.length} serial(s) have a print event.`);

    let modified = 0;
    for (let i = 0; i < printedSerials.length; i += CHUNK) {
      const chunk = printedSerials.slice(i, i + CHUNK);
      const res = await UnitSerial.updateMany(
        { serial: { $in: chunk }, printed: { $ne: true } },
        { $set: { printed: true } }
      );
      modified += res.modifiedCount || 0;
    }
    console.log(`✅ Marked ${modified} previously-printed unit(s) as printed:true (no stock/status/warehouse changed).`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillUnitPrinted failed:", err.message);
    process.exit(1);
  });
