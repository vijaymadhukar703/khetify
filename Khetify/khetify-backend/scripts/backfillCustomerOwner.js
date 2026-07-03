/**
 * backfillCustomerOwner.js — one-off migration that sets the polymorphic owner
 * on existing Customer rows: ownerType "company", ownerId = companyId. Existing
 * customers were company-owned, so their per-owner phone dedup keeps holding.
 *
 * Run ONCE from the backend folder (needs your normal .env with MONGO_URI):
 *   node scripts/backfillCustomerOwner.js
 *
 * Safe to re-run: only rows missing ownerType are touched.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Customer = require("../model/Sales/Customer");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const before = await Customer.countDocuments({ ownerType: { $exists: false } });
    console.log(`🔎 Found ${before} customer(s) without an owner.`);

    const res = await Customer.updateMany(
      { ownerType: { $exists: false } },
      [{ $set: { ownerType: "company", ownerId: "$companyId" } }]
    );
    console.log(`✅ Backfilled ownerType/ownerId on ${res.modifiedCount} customer(s).`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillCustomerOwner failed:", err.message);
    process.exit(1);
  });
