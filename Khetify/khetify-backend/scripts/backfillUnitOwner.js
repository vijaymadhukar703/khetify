/**
 * backfillUnitOwner.js — one-off migration that sets the new current-owner
 * fields on existing UnitSerial rows: ownerType "company", ownerId = companyId
 * (the originating company is also the current owner for pre-Phase-4b units).
 *
 * Run ONCE from the backend folder (needs your normal .env with MONGO_URI):
 *   node scripts/backfillUnitOwner.js
 *
 * Safe to re-run: only rows missing ownerType are touched.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const UnitSerial = require("../model/Barcode/UnitSerial");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const before = await UnitSerial.countDocuments({ ownerType: { $exists: false } });
    console.log(`🔎 Found ${before} unit serial(s) without an owner.`);

    const res = await UnitSerial.updateMany(
      { ownerType: { $exists: false } },
      [{ $set: { ownerType: "company", ownerId: "$companyId" } }]
    );
    console.log(`✅ Backfilled ownerType/ownerId on ${res.modifiedCount} unit serial(s).`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillUnitOwner failed:", err.message);
    process.exit(1);
  });
