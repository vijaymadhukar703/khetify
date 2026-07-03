const mongoose = require("mongoose");

/**
 * A KYC / business document a seller uploads once and reuses across Principal
 * Certificate applications. Files live in S3 (services/storage.js); we keep the
 * key + url + metadata here. Owner-scoped strictly by sellerId.
 */
const sellerDocumentSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    docType: { type: String, enum: ["gst", "pan", "license", "business_registration", "address_proof", "other"], default: "other" },
    label: { type: String },
    fileKey: { type: String, required: true },
    fileUrl: { type: String },
    fileName: { type: String },
    mimeType: { type: String },
    status: { type: String, enum: ["pending", "verified", "rejected"], default: "pending" },
    note: { type: String },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

sellerDocumentSchema.index({ sellerId: 1, createdAt: -1 });

module.exports = mongoose.model("SellerDocument", sellerDocumentSchema);
