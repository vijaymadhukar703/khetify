/**
 * backfillSellerCompanyLinks.js — one-off migration that creates a
 * SellerCompanyLink row for every existing seller that already has a
 * supplyingCompanyId, mirroring the seller's current linkStatus.
 *
 * Run ONCE from the backend folder (needs your normal .env with MONGO_URI):
 *   node scripts/backfillSellerCompanyLinks.js
 *
 * Safe to re-run: upserts by { sellerId, companyId } and only fills missing
 * rows (won't downgrade a status already set on an existing link).
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Seller = require("../model/Seller/Seller");
const SellerCompanyLink = require("../model/Seller/SellerCompanyLink");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const sellers = await Seller.find({ supplyingCompanyId: { $ne: null } })
      .select("supplyingCompanyId linkStatus linkRequestedAt linkDecidedAt linkRejectionReason");
    console.log(`🔎 ${sellers.length} seller(s) with a supplying company.`);

    let created = 0;
    for (const s of sellers) {
      // Map the legacy single-company linkStatus onto the link. "unlinked" never
      // has a supplyingCompanyId, so the status is always one of these three.
      const status = ["approved", "pending", "rejected"].includes(s.linkStatus) ? s.linkStatus : "pending";
      const exists = await SellerCompanyLink.findOne({ sellerId: s._id, companyId: s.supplyingCompanyId });
      if (exists) continue;
      await SellerCompanyLink.create({
        sellerId: s._id,
        companyId: s.supplyingCompanyId,
        status,
        requestedAt: s.linkRequestedAt || s.createdAt || new Date(),
        decidedAt: s.linkDecidedAt || undefined,
        rejectionReason: s.linkRejectionReason || undefined,
      });
      created += 1;
    }
    console.log(`✅ Created ${created} seller-company link(s).`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ backfillSellerCompanyLinks failed:", err.message);
    process.exit(1);
  });
