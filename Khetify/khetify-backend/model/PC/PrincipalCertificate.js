const mongoose = require("mongoose");

/**
 * The issued Principal Certificate — the artifact that authorizes a seller to
 * resell a specific company's products. A seller may hold MANY (one per
 * company). `status` is active/expired/revoked; expiry is computed on read from
 * validUntil (and a daily job can persist it).
 */
const principalCertificateSchema = new mongoose.Schema(
  {
    pcNumber: { type: String, required: true, unique: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: "PCApplication" },
    agreementId: { type: mongoose.Schema.Types.ObjectId, ref: "SellerAgreement" },
    authorization: {
      productCategories: [{ type: String }],
      brandName: { type: String },
    },
    validFrom: { type: Date },
    validUntil: { type: Date },
    // A PC is active immediately on issue. ("pending_govt" is a retired status —
    // kept in the enum only so legacy rows still read; it is never set anymore.)
    status: { type: String, enum: ["pending_govt", "active", "expired", "revoked"], default: "active" },
    pdfKey: { type: String },
    pdfUrl: { type: String },
    // Retired government-approval metadata. Kept (defaulting to not-required) so
    // legacy documents read without error; no longer part of the PC flow.
    govt: {
      required: { type: Boolean, default: false },
      status: { type: String, enum: ["not_required", "pending", "submitted", "approved", "rejected"], default: "not_required" },
      reference: { type: String },
      authority: { type: String },
      submittedAt: { type: Date },
      proofFileKey: { type: String },
      proofFileUrl: { type: String },
      verifiedBy: { type: mongoose.Schema.Types.ObjectId },
      verifiedAt: { type: Date },
      rejectionReason: { type: String },
      approvedAt: { type: Date },
    },
    issuedBy: { type: mongoose.Schema.Types.ObjectId },
    issuedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date },
    revokedReason: { type: String },
  },
  { timestamps: true }
);

principalCertificateSchema.index({ sellerId: 1, companyId: 1 });
principalCertificateSchema.index({ companyId: 1, status: 1 });

/** True when the cert authorizes listing right now: issued (active) + within validity. */
principalCertificateSchema.methods.isCurrentlyActive = function isCurrentlyActive() {
  if (this.status !== "active") return false;
  if (this.validUntil && new Date(this.validUntil) < new Date()) return false;
  return true;
};

module.exports = mongoose.model("PrincipalCertificate", principalCertificateSchema);
