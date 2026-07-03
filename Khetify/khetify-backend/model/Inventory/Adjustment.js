const mongoose = require("mongoose");

/**
 * A stock correction that is APPLIED ONLY ON APPROVAL. The requester proposes
 * a signed qtyDelta with a reason; an approver (≠ requester) approves, at which
 * point the delta is applied to the inventory row (and bin, if given) inside a
 * transaction with an 'adjustment' ledger row. This separation of duties is the
 * core shrinkage-control mechanism.
 *
 * Adjustments are created manually or auto-generated from cycle-count variances.
 */
const adjustmentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    adjustmentNumber: { type: String, required: true }, // ADJ-YYYYMM-####

    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },

    qtyDelta: { type: Number, required: true }, // signed correction to physical stock
    reason: {
      type: String,
      enum: ["count_variance", "damage", "theft", "expiry", "data_entry", "other"],
      required: true,
    },
    note: { type: String },

    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },

    source: { type: String, enum: ["manual", "cycle_count"], default: "manual" },
    cycleCountId: { type: mongoose.Schema.Types.ObjectId, ref: "CycleCount", default: null },

    requestedBy: { type: mongoose.Schema.Types.ObjectId },
    approvedBy: { type: mongoose.Schema.Types.ObjectId },
    decidedAt: { type: Date },
  },
  { timestamps: true }
);

adjustmentSchema.index({ companyId: 1, adjustmentNumber: 1 }, { unique: true });
adjustmentSchema.index({ companyId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Adjustment", adjustmentSchema);
