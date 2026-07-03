/**
 * backfillUserOwner.js — one-off migration setting the owner fields on existing
 * team-member User rows: ownerType "company", ownerId = companyId (all existing
 * users are company team members).
 *
 * Run ONCE from the backend folder (needs your .env with MONGO_URI):
 *   node scripts/backfillUserOwner.js
 *
 * Safe to re-run: only rows missing ownerType are touched.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../model/User/User");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const users = await User.find({ ownerType: { $exists: false } }).select("_id companyId");
    console.log(`🔎 ${users.length} user(s) without an owner.`);
    let n = 0;
    for (const u of users) {
      await User.updateOne({ _id: u._id }, { $set: { ownerType: "company", ownerId: u.companyId } });
      n += 1;
    }
    console.log(`✅ Backfilled ownerType/ownerId on ${n} user(s).`);
  } finally {
    await mongoose.connection.close();
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error("❌ backfillUserOwner failed:", err.message); process.exit(1); });
