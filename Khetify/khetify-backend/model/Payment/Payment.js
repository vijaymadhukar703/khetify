const mongoose = require("mongoose");

/** A billing record — one row per plan charge / renewal. */
const paymentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    invoiceNo: { type: String },
    plan: { type: String },
    amount: { type: Number, default: 0 },
    method: { type: String, default: "card" },
    status: { type: String, enum: ["paid", "pending", "failed", "refunded"], default: "paid" },
    paidAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

paymentSchema.index({ companyId: 1, paidAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
