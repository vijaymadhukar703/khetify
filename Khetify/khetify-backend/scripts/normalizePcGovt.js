/**
 * normalizePcGovt.js — one-off normalization after removing the government-
 * approval (regulated) PC option. Any PC that was stuck awaiting government
 * approval is treated as active so it isn't orphaned.
 *
 * What it does (idempotent, safe to re-run):
 *  1. PrincipalCertificate.status "pending_govt" → "active" (+ govt cleared to
 *     not-required) and reconciles the seller↔company link.
 *  2. PCApplication.status "govt_pending" / "govt_approved" → "active".
 *  3. Prints how many of each were adjusted.
 *
 * Run from the backend folder (needs your .env with MONGO_URI):
 *   node scripts/normalizePcGovt.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const PCApplication = require("../model/PC/PCApplication");
const pcService = require("../services/pcService");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    // 1) Certificates stuck pending_govt → active.
    const stuckCerts = await PrincipalCertificate.find({ status: "pending_govt" }).select("sellerId companyId");
    for (const c of stuckCerts) {
      await PrincipalCertificate.updateOne(
        { _id: c._id },
        { $set: { status: "active", "govt.required": false, "govt.status": "not_required" } }
      );
      await pcService.reconcileLink(c.sellerId, c.companyId);
    }

    // 2) Applications mirroring a govt state → active.
    const appRes = await PCApplication.updateMany(
      { status: { $in: ["govt_pending", "govt_approved"] } },
      { $set: { status: "active" } }
    );

    console.log("──────── normalize PC govt ────────");
    console.log(`✅ certificates pending_govt → active : ${stuckCerts.length}`);
    console.log(`✅ applications govt_* → active        : ${appRes.modifiedCount || 0}`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ normalizePcGovt failed:", err.message);
    process.exit(1);
  });
