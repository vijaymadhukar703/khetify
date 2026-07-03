const mongoose = require("mongoose");

/**
 * Append-only per-unit movement history. One row per status change / scan
 * event for a UnitSerial. Kept separate from UnitSerial so the serial doc
 * stays small. This is the unit-level audit trail (complements StockMovement,
 * which is quantity-level).
 */
const unitEventSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    serial: { type: String, required: true },
    event: { type: String, required: true }, // e.g. "generated","putaway","picked","shipped","sold","recalled"
    fromStatus: { type: String },
    toStatus: { type: String },
    refType: { type: String }, // "GRN" | "PickList" | "Shipment" | "Order" | "Recall" | ...
    refId: { type: mongoose.Schema.Types.ObjectId },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
    actorId: { type: mongoose.Schema.Types.ObjectId },
    note: { type: String },
  },
  { timestamps: { createdAt: "at", updatedAt: false } }
);

unitEventSchema.index({ serial: 1, at: 1 });
unitEventSchema.index({ companyId: 1, at: -1 });

module.exports = mongoose.model("UnitEvent", unitEventSchema);
