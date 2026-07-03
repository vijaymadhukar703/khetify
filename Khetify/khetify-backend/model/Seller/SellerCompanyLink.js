const mongoose = require("mongoose");

/**
 * A seller↔company link. A seller can apply to (and be approved by) MULTIPLE
 * companies; each pairing is one row here. The seller's ACTIVE company (used by
 * supply/catalog/inventory today) remains `Seller.supplyingCompanyId` — this
 * collection records the full set of links + their per-company status.
 */
const sellerCompanyLinkSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    requestedAt: { type: Date, default: Date.now },
    decidedAt: { type: Date },
    rejectionReason: { type: String },
  },
  { timestamps: true }
);

// One link per (seller, company).
sellerCompanyLinkSchema.index({ sellerId: 1, companyId: 1 }, { unique: true });
sellerCompanyLinkSchema.index({ companyId: 1, status: 1 });

module.exports = mongoose.model("SellerCompanyLink", sellerCompanyLinkSchema);
