/**
 * dropLegacySubscriptionIndex.js — one-off fix for:
 *   E11000 duplicate key error … subscriptions index: companyId_1 dup key: { companyId: null }
 *
 * The subscriptions collection once had a UNIQUE index on companyId (when a
 * subscription belonged only to a company). Subscriptions are now
 * owner-polymorphic (ownerType/ownerId); SELLER subscriptions carry
 * companyId:null, and a unique index can't hold two nulls. This drops the stale
 * companyId_1 index so seller plan switches work. The canonical owner index
 * (ownerType_1_ownerId_1) is unaffected.
 *
 * Run from the backend folder (needs your .env with MONGO_URI):
 *   node scripts/dropLegacySubscriptionIndex.js
 * Safe + idempotent: a no-op if the index is already gone.
 */
require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const coll = mongoose.connection.collection("subscriptions");
    const idx = await coll.indexes();
    if (idx.some((i) => i.name === "companyId_1")) {
      await coll.dropIndex("companyId_1");
      console.log("✅ Dropped legacy subscriptions.companyId_1 unique index.");
    } else {
      console.log("ℹ️  No legacy companyId_1 index found — nothing to do.");
    }
  } finally {
    await mongoose.connection.close();
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error("❌ dropLegacySubscriptionIndex failed:", err.message); process.exit(1); });
