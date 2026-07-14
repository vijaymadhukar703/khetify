const mongoose = require("mongoose");

/**
 * One document per (product, owner, location, batch).
 * availableStock is the ONLY number the marketplace reads for "in stock?".
 * availableStock = onlineStock + offlineStock - reservedStock
 */
const inventorySchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    ownerType: {
      type: String,
      enum: ["company", "seller"],
      required: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },

    // Premium (batch_expiry) — optional
    // NOTE: `batchNumber` is the lot IDENTITY key (part of the unique index
    // below) and is shadowed to equal `lotNumber` by lotService.receiveLot —
    // it is NOT a free-text manufacturer batch. The manufacturer/supplier batch
    // number entered per lot lives in `mfgBatchNo` (optional, non-indexed) so it
    // can be captured separately without touching the identity/index invariant.
    batchNumber: { type: String, default: null },
    lotNumber:   { type: String, default: null },
    mfgBatchNo:  { type: String, default: null }, // manufacturer/supplier batch no. (optional, display-only)
    expiryDate: { type: Date, default: null },
    mfgDate: { type: Date, default: null }, // manufacturing date, captured per lot

    onlineStock: { type: Number, default: 0 },
    offlineStock: { type: Number, default: 0 },
    reservedStock: { type: Number, default: 0 },
    damagedStock: { type: Number, default: 0 },
    availableStock: { type: Number, default: 0 },

    lowStockThreshold: { type: Number, default: 0 },

    // Weighted-average cost per unit, maintained on each receipt (GRN unitCost).
    // Drives stock valuation in reports.
    costPrice: { type: Number, default: 0 },

    // ABC velocity class (A=fast/high-value … C=slow). Set by the nightly
    // classifyABC job; drives cycle-count frequency guidance.
    abcClass: { type: String, enum: ["A", "B", "C", null], default: null },
  },
  { timestamps: true }
);

// One row per product/owner/location/batch.
inventorySchema.index(
  { productId: 1, ownerType: 1, ownerId: 1, warehouseId: 1, batchNumber: 1 },
  { unique: true }
);

module.exports = mongoose.model("Inventory", inventorySchema);
