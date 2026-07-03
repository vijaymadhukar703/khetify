const mongoose = require("mongoose");

/**
 * A seller's published marketplace listing of a company's product. Publishing
 * is gated by requireActivePC(companyId) + an active subscription, so a listing
 * can only exist while the seller is an authorized reseller of that company.
 */
const sellerListingSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    status: { type: String, enum: ["published", "unpublished"], default: "published" },
    price: { type: Number },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

sellerListingSchema.index({ sellerId: 1, companyId: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model("SellerListing", sellerListingSchema);
