const mongoose = require("mongoose");

/**
 * Seller inter-warehouse transfer — the owner-aware mirror of the company
 * transfer (TransferRequest + the lot move). A seller moves a lot of stock from
 * one of their OWN warehouses to another; the stock move itself is performed by
 * the shared, owner-aware lotService.transferLot (append-only transfer_out /
 * transfer_in ledger, invariant preserved). This row is the record shown on the
 * seller's Transfers view, mirroring how the company shows transfers.
 *
 * Kept deliberately simple (single-step "completed") — the simple end of the
 * spectrum the company flow allows. Everything is scoped by sellerId.
 */
const sellerTransferSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    fromWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },
    toWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },
    lotNumber: { type: String },
    batchNumber: { type: String },
    qty: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["completed", "cancelled"], default: "completed", index: true },
    note: { type: String, maxlength: 500 },
    // Who initiated it (the seller account or a team member User id).
    performedBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

sellerTransferSchema.index({ sellerId: 1, createdAt: -1 });
sellerTransferSchema.index({ sellerId: 1, fromWarehouseId: 1 });
sellerTransferSchema.index({ sellerId: 1, toWarehouseId: 1 });

module.exports = mongoose.model("SellerTransfer", sellerTransferSchema);
