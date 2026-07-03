/**
 * fixLotNumberingMethod.js — one-off migration that clears the removed
 * "company_pattern" value from Company.imsSettings.lotNumberingMethod.
 *
 * The lot-numbering cleanup narrowed the enum to
 * ["company_defined","khetify_generated"], but existing company documents may
 * still have the old "company_pattern" saved. Any full-document validation on
 * those docs (e.g. the last-login save) then throws "Company validation failed"
 * and blocks login. This rewrites the stale value to a valid one.
 *
 * lotNumberingMethod is now vestigial (numbering is chosen per-lot), so any
 * valid enum value works — "khetify_generated" is the safe default.
 *
 * Run ONCE from the backend folder (needs your normal .env with MONGO_URI):
 *   node scripts/fixLotNumberingMethod.js
 *
 * Safe to re-run: the filter only matches docs still carrying "company_pattern".
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Company = require("../model/Company/Company");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const before = await Company.countDocuments({ "imsSettings.lotNumberingMethod": "company_pattern" });
    console.log(`🔎 Found ${before} company(ies) on the removed 'company_pattern' value.`);

    const res = await Company.updateMany(
      { "imsSettings.lotNumberingMethod": "company_pattern" },
      { $set: { "imsSettings.lotNumberingMethod": "khetify_generated" } }
    );
    console.log(`✅ Updated ${res.modifiedCount} company(ies) off the removed 'company_pattern' value.`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ fixLotNumberingMethod failed:", err.message);
    process.exit(1);
  });
