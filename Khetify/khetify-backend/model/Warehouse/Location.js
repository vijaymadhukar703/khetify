const mongoose = require("mongoose");

/**
 * A node in a warehouse's internal storage hierarchy:
 *   zone → aisle → rack → shelf → bin
 *
 * `parentId` links a node to its parent (null for top-level zones).
 * `fullCode` is the human + scannable address built from the warehouse code
 * and every ancestor code, e.g. "WH1-A-R03-S2-B07". It is unique per
 * warehouse and doubles as the printed barcode value.
 *
 * Only leaf bins physically hold stock (tracked in InventoryBin). Higher
 * levels exist for navigation, capacity roll-ups and putaway zoning.
 */
const locationSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },

    type: { type: String, enum: ["zone", "aisle", "rack", "shelf", "bin"], required: true },
    code: { type: String, required: true }, // local segment, e.g. "B07"
    fullCode: { type: String, required: true }, // full address, e.g. "WH1-A-R03-S2-B07"
    barcode: { type: String }, // === fullCode

    capacityUnits: { type: Number, default: 0 },
    allowedCategories: { type: [String], default: [] }, // empty = any category
    isPickFace: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

locationSchema.index({ warehouseId: 1, fullCode: 1 }, { unique: true });
locationSchema.index({ warehouseId: 1, type: 1 });
locationSchema.index({ companyId: 1, warehouseId: 1, parentId: 1 });

module.exports = mongoose.model("Location", locationSchema);
