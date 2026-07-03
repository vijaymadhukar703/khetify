const mongoose = require("mongoose");

/**
 * Append-only ledger. Every stock change writes exactly one row here.
 * This is the audit trail AND the data source for analytics
 * (fast movers, dead stock, sales trends).
 */
const stockMovementSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    ownerType: { type: String, enum: ["company", "seller"] },
    ownerId: { type: mongoose.Schema.Types.ObjectId },

    type: {
      type: String,
      required: true,
      enum: [
        "supply_in",
        "supply_out",
        "sale_online",
        "sale_offline",
        "return",
        "adjustment",
        "reserve",
        "release",
        "transfer_in",
        "transfer_out",
        "damage",
        "bin_move",
        "writeoff",
        "in_transit_out",
        "in_transit_in",
      ],
    },
    channel: { type: String, enum: ["online", "offline", "internal"], default: "internal" },

    quantity: { type: Number, required: true }, // signed (+in / -out)
    balanceAfter: { type: Number },

    refType: { type: String }, // "Order" | "SupplyOrder" | "Transfer" | "Manual"
    refId: { type: mongoose.Schema.Types.ObjectId },

    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    note: { type: String },
  },
  { timestamps: true }
);

stockMovementSchema.index({ productId: 1, createdAt: -1 });
stockMovementSchema.index({ ownerId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("StockMovement", stockMovementSchema);
