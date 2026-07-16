/**
 * backfillTransferLotMetadata.js — repair destination lots created by a
 * warehouse→warehouse transfer receipt BEFORE the metadata fix.
 *
 * Bug: verifyReceipt's company-transfer branch upserted the destination lot with
 * only { lotNumber } and the quantity, so a NEW destination row was created with
 * expiryDate / mfgDate / mfgBatchNo = null. The Inventory list then showed
 * "—" for Batch No. / MFG / Expiry and "No expiry".
 *
 * This finds every destination row landed by a transfer receipt, walks back to
 * the EXACT source lot through the shipment that landed it, and fills ONLY the
 * fields that are missing.
 *
 *   StockMovement { type: "in_transit_in", refType: "Transfer", refId: <shipment> }
 *     -> inventoryId  = the destination lot row
 *     -> shipment.lines[] -> line.inventoryId = the SOURCE lot row
 *
 * Safety:
 *  - Never guesses from product defaults — only the real source lot is used.
 *  - Never touches a field that already has a value (complete rows untouched).
 *  - Changes NO quantity, status, ledger row, unit or shipment.
 *  - Idempotent: a second run reports 0.
 *
 * Run from the backend folder (needs .env with MONGO_URI):
 *   node scripts/backfillTransferLotMetadata.js
 *   node scripts/backfillTransferLotMetadata.js --dry     (report only)
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const Shipment = require("../model/Transport/Shipment");

const FIELDS = ["expiryDate", "mfgDate", "mfgBatchNo"];
const isMissing = (v) => v === null || v === undefined || v === "";

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");
  const dry = process.argv.includes("--dry");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    // Every destination lot that a transfer receipt landed stock into.
    const moves = await StockMovement.find({ type: "in_transit_in", refType: "Transfer" })
      .select("inventoryId productId refId").lean();
    console.log(`🔎 ${moves.length} transfer-receipt movement(s) to inspect.`);

    const shipmentCache = new Map();
    const srcCache = new Map();
    let repaired = 0;
    let skippedComplete = 0;
    let unresolved = 0;
    const seen = new Set();

    for (const m of moves) {
      const destId = String(m.inventoryId);
      if (seen.has(destId)) continue; // one repair per destination row
      seen.add(destId);

      const dest = await Inventory.findById(destId);
      if (!dest) continue;

      const missing = FIELDS.filter((f) => isMissing(dest[f]));
      if (!missing.length) { skippedComplete++; continue; }

      // The shipment that landed it -> the exact source lot.
      let shipment = shipmentCache.get(String(m.refId));
      if (!shipment) {
        shipment = await Shipment.findById(m.refId).select("lines").lean();
        shipmentCache.set(String(m.refId), shipment || null);
      }
      if (!shipment) { unresolved++; continue; }

      // Match the line by product, preferring an exact batch match.
      const lines = (shipment.lines || []).filter((l) => String(l.productId) === String(dest.productId));
      const line = lines.find((l) => String(l.batchNumber || "") === String(dest.batchNumber || "")) || lines[0];
      if (!line?.inventoryId) { unresolved++; continue; }

      let src = srcCache.get(String(line.inventoryId));
      if (!src) {
        src = await Inventory.findById(line.inventoryId).select("expiryDate mfgDate mfgBatchNo lotNumber").lean();
        srcCache.set(String(line.inventoryId), src || null);
      }
      if (!src) { unresolved++; continue; }

      // Fill ONLY the missing fields, and only where the source actually has one.
      const $set = {};
      for (const f of missing) if (!isMissing(src[f])) $set[f] = src[f];
      if (!Object.keys($set).length) { unresolved++; continue; }

      console.log(
        `  ${dry ? "[dry] " : ""}${dest.lotNumber || dest.batchNumber || destId} ` +
        `<- source ${src.lotNumber || line.inventoryId} :: ${Object.keys($set).join(", ")}`
      );
      if (!dry) await Inventory.updateOne({ _id: dest._id }, { $set });
      repaired++;
    }

    console.log(
      `\n${dry ? "🧪 DRY RUN — nothing written." : "✅ Done."}\n` +
      `   repaired: ${repaired}\n` +
      `   already complete (untouched): ${skippedComplete}\n` +
      `   could not resolve a source lot: ${unresolved}\n` +
      `   No quantity, ledger, unit or shipment was modified.`
    );
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillTransferLotMetadata failed:", err.message);
    process.exit(1);
  });
