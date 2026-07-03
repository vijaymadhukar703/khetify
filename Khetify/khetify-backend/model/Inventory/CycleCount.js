const mongoose = require("mongoose");

/**
 * A stock count — either a rolling cycle count (scoped by zone/category/ABC)
 * or a full physical audit of a warehouse. systemQty is SNAPSHOT at generation
 * so variance is measured against the moment counting started.
 *
 * A full audit may set `freeze: true`; while it is open/counting, outward stock
 * operations on that warehouse are blocked (see services/freezeService.js).
 */
const cycleCountLineSchema = new mongoose.Schema(
  {
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
    systemQty: { type: Number, required: true }, // snapshot
    countedQty: { type: Number, default: null },
    countedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    recount: { type: Boolean, default: false },
    varianceAdjustmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Adjustment", default: null },
  },
  { _id: false }
);

const cycleCountSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    countNumber: { type: String, required: true }, // CC-YYYYMM-####
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },

    type: { type: String, enum: ["cycle", "full_audit"], default: "cycle" },
    freeze: { type: Boolean, default: false },

    scope: {
      zoneId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
      category: { type: String, default: null },
      abcClass: { type: String, enum: ["A", "B", "C", null], default: null },
    },

    status: { type: String, enum: ["open", "counting", "completed", "cancelled"], default: "open" },
    lines: [cycleCountLineSchema],

    createdBy: { type: mongoose.Schema.Types.ObjectId },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

cycleCountSchema.index({ companyId: 1, countNumber: 1 }, { unique: true });
cycleCountSchema.index({ companyId: 1, status: 1, createdAt: -1 });
// fast lookup for active freezes on a warehouse
cycleCountSchema.index({ companyId: 1, warehouseId: 1, freeze: 1, status: 1 });

module.exports = mongoose.model("CycleCount", cycleCountSchema);
