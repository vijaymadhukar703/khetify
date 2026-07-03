const mongoose = require("mongoose");

/**
 * Records a mismatch found when a shipment is received (short / damaged /
 * excess). Created automatically during verifyReceipt; surfaces in the
 * exceptions queue for investigation.
 */
const discrepancySchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    lotNumber: { type: String },
    expectedQty: { type: Number },
    receivedQty: { type: Number },
    shortageQty: { type: Number }, // expected − received (negative = excess)
    serials: { type: [String], default: [] },
    reason: { type: String }, // shortage | damage | excess
    adjustmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Adjustment", default: null },
    status: { type: String, enum: ["open", "resolved"], default: "open" },
  },
  { timestamps: true }
);

discrepancySchema.index({ companyId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Discrepancy", discrepancySchema);
