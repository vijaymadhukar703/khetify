const mongoose = require("mongoose");

/**
 * Cost structure per product, with an approval workflow:
 * a finance/sales role REQUESTS a change (pendingChange) → the owner
 * (company_admin) APPROVES → it's applied. totalCost sums every cost
 * component (purchase + production + packaging + storage + transport), so for
 * trading companies that only fill purchase + transport,
 * Total Cost = Purchase Cost + Transport Cost. Profitability = sellingPrice − totalCost.
 */
const costFields = {
  purchaseCost: { type: Number, default: 0 },
  productionCost: { type: Number, default: 0 },
  packagingCost: { type: Number, default: 0 },
  storageCost: { type: Number, default: 0 },
  transportCost: { type: Number, default: 0 },
  sellingPrice: { type: Number, default: 0 },
};

const productCostSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    ...costFields,
    totalCost: { type: Number, default: 0 },
    pendingChange: {
      type: new mongoose.Schema(
        { ...costFields, requestedBy: mongoose.Schema.Types.ObjectId, requestedAt: Date, note: String },
        { _id: false }
      ),
      default: null,
    },
  },
  { timestamps: true }
);

productCostSchema.index({ companyId: 1, productId: 1 }, { unique: true });
productCostSchema.pre("save", function () {
  this.totalCost = (this.purchaseCost || 0) + (this.productionCost || 0) + (this.packagingCost || 0) + (this.storageCost || 0) + (this.transportCost || 0);
});

module.exports = mongoose.model("ProductCost", productCostSchema);
