const mongoose = require("mongoose");

/**
 * The authorization agreement generated when a company approves a PC
 * application. The seller signs it (digitally or by uploading a scan) before
 * the company issues the certificate. PDFs live in S3.
 */
const sellerAgreementSchema = new mongoose.Schema(
  {
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: "PCApplication", required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    templateVersion: { type: String, default: "v1" },
    termsText: { type: String },
    unsignedPdfKey: { type: String },
    unsignedPdfUrl: { type: String },
    // Company-attached contract (replaces the auto-generated draft as the
    // document the seller signs, when provided).
    agreementFileKey: { type: String },
    agreementFileUrl: { type: String },
    attachedAt: { type: Date },
    attachedBy: { type: mongoose.Schema.Types.ObjectId },
    status: { type: String, enum: ["generated", "signed"], default: "generated" },
    signatureType: { type: String, enum: ["digital", "uploaded"] },
    signedName: { type: String },
    signedAt: { type: Date },
    signedPdfKey: { type: String },
    signedPdfUrl: { type: String },
    ip: { type: String },
  },
  { timestamps: true }
);

sellerAgreementSchema.index({ applicationId: 1 });

module.exports = mongoose.model("SellerAgreement", sellerAgreementSchema);
