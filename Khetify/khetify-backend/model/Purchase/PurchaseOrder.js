const mongoose = require("mongoose");

const poItemSchema = new mongoose.Schema(
  { name: { type: String }, qty: { type: Number, required: true }, price: { type: Number, default: 0 } },
  { _id: false }
);

/** A purchase order raised to a vendor for incoming stock / materials. */
const purchaseOrderSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    poNumber: { type: String },
    items: [poItemSchema],
    totalAmount: { type: Number, default: 0 },
    status: { type: String, enum: ["draft", "sent", "received", "cancelled"], default: "draft" },
    expectedDate: { type: Date },
  },
  { timestamps: true }
);

purchaseOrderSchema.index({ companyId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("PurchaseOrder", purchaseOrderSchema);
