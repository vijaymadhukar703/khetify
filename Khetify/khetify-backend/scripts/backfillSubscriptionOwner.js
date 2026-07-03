/**
 * backfillSubscriptionOwner.js — one-off migration that sets the polymorphic
 * owner on existing Subscription rows: ownerType "company", ownerId = companyId.
 *
 * Run ONCE from the backend folder (needs your normal .env with MONGO_URI):
 *   node scripts/backfillSubscriptionOwner.js
 *
 * NOTE: the old unique index on `companyId` should be dropped after this runs
 * (the schema now uses a unique { ownerType, ownerId } index). Drop manually if
 * present:  db.subscriptions.dropIndex("companyId_1")
 *
 * Safe to re-run: only rows missing ownerType are touched.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Subscription = require("../model/Company/Subscription/Subscription");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const before = await Subscription.countDocuments({ ownerType: { $exists: false } });
    console.log(`🔎 Found ${before} subscription(s) without an owner.`);

    const res = await Subscription.updateMany(
      { ownerType: { $exists: false } },
      [{ $set: { ownerType: "company", ownerId: "$companyId" } }]
    );
    console.log(`✅ Backfilled ownerType/ownerId on ${res.modifiedCount} subscription(s).`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillSubscriptionOwner failed:", err.message);
    process.exit(1);
  });
