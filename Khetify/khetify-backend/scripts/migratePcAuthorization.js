/**
 * migratePcAuthorization.js — one-off migration for the new model where issuing
 * a Principal Certificate IS the seller↔company authorization (the separate
 * "request link → approve link" step is gone).
 *
 * What it does (idempotent, safe to re-run):
 *  1. For every APPROVED SellerCompanyLink whose seller does NOT already hold an
 *     active PC for that company, mint a minimal ACTIVE PrincipalCertificate so
 *     the seller keeps selling that company's products. reconcileLink keeps the
 *     legacy linkStatus mirror in sync.
 *  2. Deletes PENDING link-requests (they no longer apply — sellers must apply
 *     for a PC). Sellers left at linkStatus "pending" with no approval are reset
 *     to "unlinked".
 *  3. Prints counts.
 *
 * Run ONCE from the backend folder (needs your .env with MONGO_URI):
 *   node scripts/migratePcAuthorization.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Seller = require("../model/Seller/Seller");
const Company = require("../model/Company/Company");
const SellerCompanyLink = require("../model/Seller/SellerCompanyLink");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const { nextSeq } = require("../services/counterService");
const pcService = require("../services/pcService");

/** Mint a minimal active PC for an approved (seller, company) pair. */
async function mintActivePc(sellerId, companyId) {
  const company = await Company.findById(companyId).select("companyInfo.companyName fullName");
  if (!company) return false;
  const seq = await nextSeq(companyId, "principal-certificate");
  const year = new Date().getFullYear();
  const pcNumber = `KH-PC-${pcService._internal.companyCode(company)}-${year}-${String(seq).padStart(4, "0")}`;
  const validFrom = new Date();
  const validUntil = new Date(validFrom.getTime());
  validUntil.setFullYear(validUntil.getFullYear() + 10); // long validity for migrated authorizations
  await PrincipalCertificate.create({
    pcNumber, sellerId, companyId,
    authorization: {},
    validFrom, validUntil,
    status: "active",
    govt: { required: false, status: "not_required" },
    issuedAt: new Date(),
  });
  await pcService.reconcileLink(sellerId, companyId);
  return true;
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    // 1) Approved links → active PCs (skip pairs that already have one).
    const approved = await SellerCompanyLink.find({ status: "approved" }).select("sellerId companyId");
    console.log(`🔎 ${approved.length} approved seller↔company link(s).`);
    let minted = 0, already = 0, noCompany = 0;
    for (const link of approved) {
      if (await pcService.hasActivePc(link.sellerId, link.companyId)) { already += 1; continue; }
      const ok = await mintActivePc(link.sellerId, link.companyId);
      if (ok) minted += 1; else noCompany += 1;
    }

    // 2) Pending link-requests no longer apply — drop them.
    const droppedPending = (await SellerCompanyLink.deleteMany({ status: "pending" })).deletedCount || 0;

    // 3) Reset sellers stuck at "pending" with no approval anywhere.
    const stuck = await Seller.find({ linkStatus: "pending" }).select("_id");
    let reset = 0;
    for (const s of stuck) {
      const stillApproved = await SellerCompanyLink.exists({ sellerId: s._id, status: "approved" });
      if (!stillApproved) {
        await Seller.updateOne({ _id: s._id }, { $set: { linkStatus: "unlinked" } });
        reset += 1;
      }
    }

    console.log("──────── migration result ────────");
    console.log(`✅ active PCs minted from approved links : ${minted}`);
    console.log(`↷ approved links already PC-active       : ${already}`);
    console.log(`⚠ approved links skipped (no company)    : ${noCompany}`);
    console.log(`🗑 pending link-requests dropped          : ${droppedPending}`);
    console.log(`↩ sellers reset pending→unlinked          : ${reset}`);
  } finally {
    await mongoose.connection.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ migratePcAuthorization failed:", err.message);
    process.exit(1);
  });
