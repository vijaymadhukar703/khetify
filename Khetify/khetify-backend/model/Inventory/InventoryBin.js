const mongoose = require("mongoose");

/**
 * Subdivides ONE Inventory row's physical stock across the bins it occupies,
 * WITHOUT touching the Inventory unique index
 * (productId, ownerType, ownerId, warehouseId, batchNumber).
 *
 * Invariant (enforced in services only — see services/locationService.js):
 *   sum(InventoryBin.qty where inventoryId = X) <= Inventory(X).onlineStock + offlineStock
 *
 * The difference (total − binned) is "unbinned / receiving-pool" stock that
 * has not yet been put away. Putaway (Sprint 2) and moveBinStock() are the
 * only writers; both go through the service so the invariant holds.
 */
const inventoryBinSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", required: true },
    qty: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

inventoryBinSchema.index({ inventoryId: 1, locationId: 1 }, { unique: true });
inventoryBinSchema.index({ locationId: 1 }); // "what's in this bin?"

module.exports = mongoose.model("InventoryBin", inventoryBinSchema);
