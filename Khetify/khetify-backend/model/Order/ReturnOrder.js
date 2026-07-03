const mongoose = require("mongoose");

/**
 * A customer return (RMA). Posting a return creates a GRN of refType "Return"
 * so returned goods re-enter through the same controlled inbound gate:
 *   condition "resellable" → back to sellable stock
 *   condition "damaged"/"expired" → damagedStock (quarantined, not sellable)
 */
const returnLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String },
    qty: { type: Number, required: true },
    serials: { type: [String], default: [] }, // populated once units are serialized (Sprint 3)
    lotNumber: { type: String },
    batchNumber: { type: String },
    reason: { type: String },
    condition: { type: String, enum: ["resellable", "damaged", "expired"], default: "resellable" },
  },
  { _id: false }
);

const returnOrderSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    returnNumber: { type: String, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },

    lines: [returnLineSchema],
    status: { type: String, enum: ["draft", "received", "completed", "cancelled"], default: "draft" },
    grnId: { type: mongoose.Schema.Types.ObjectId, ref: "GRN", default: null }, // set when posted
    notes: { type: String },
  },
  { timestamps: true }
);

returnOrderSchema.index({ companyId: 1, returnNumber: 1 }, { unique: true });
returnOrderSchema.index({ companyId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("ReturnOrder", returnOrderSchema);
