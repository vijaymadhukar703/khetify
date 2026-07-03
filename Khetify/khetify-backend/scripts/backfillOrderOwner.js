/**
 * backfillOrderOwner.js — one-off migration that sets the polymorphic owner on
 * existing Order rows: ownerType "company", ownerId = companyId.
 *
 * Run ONCE from the backend folder (needs your normal .env with MONGO_URI):
 *   node scripts/backfillOrderOwner.js
 *
 * Safe to re-run: only rows missing ownerType are touched.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Order = require("../model/Order/Order");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const before = await Order.countDocuments({ ownerType: { $exists: false } });
    console.log(`🔎 Found ${before} order(s) without an owner.`);

    const res = await Order.updateMany(
      { ownerType: { $exists: false } },
      [{ $set: { ownerType: "company", ownerId: "$companyId" } }]
    );
    console.log(`✅ Backfilled ownerType/ownerId on ${res.modifiedCount} order(s).`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillOrderOwner failed:", err.message);
    process.exit(1);
  });
