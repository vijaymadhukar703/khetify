/**
 * stripUnitPrefix.js — one-off migration that drops the legacy "K-U-" prefix
 * from existing unit serials so the database matches the new prefix-less format
 * (e.g. "K-U-ABSAMIO012-001" → "ABSAMIO012-001"). Lot barcodes ("K-L-…") are
 * NOT touched.
 *
 * Run ONCE from the backend folder (needs your normal .env with MONGO_URI):
 *   node scripts/stripUnitPrefix.js
 *
 * Safe to re-run: the filter only matches serials that still carry "K-U-", so a
 * second run is a no-op. Even before this runs, resolveScan() keeps old printed
 * "K-U-" labels scannable, so the migration is not time-critical.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const UnitSerial = require("../model/Barcode/UnitSerial");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const before = await UnitSerial.countDocuments({ serial: /^K-U-/i });
    console.log(`🔎 Found ${before} unit serial(s) still carrying the "K-U-" prefix.`);

    const res = await UnitSerial.updateMany(
      { serial: /^K-U-/i },
      [{ $set: { serial: { $replaceOne: { input: "$serial", find: "K-U-", replacement: "" } } } }]
    );
    console.log(`✅ Stripped K-U- from ${res.modifiedCount} unit serial(s).`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ stripUnitPrefix failed:", err.message);
    process.exit(1);
  });
