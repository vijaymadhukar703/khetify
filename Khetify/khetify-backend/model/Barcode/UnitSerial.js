const mongoose = require("mongoose");

/**
 * One document per physical product unit, identified by a unique system
 * barcode `serial` (format K-U-<LOTNUMBER>-<seq>; see services/barcodeService.js
 * and BARCODES.md). This is the traceability backbone — it ties a scanned unit
 * to its lot, its current location/shipment, and ultimately the order/customer
 * it was sold to, enabling unit-level recall.
 *
 * Per-unit movement history is NOT embedded — it lives in UnitEvent so this
 * document stays small and writes stay cheap at scale.
 */
const UNIT_STATUSES = [
  "generated", // serial created, label not yet printed
  "printed",
  "in_stock", // put away into a bin
  "picked",
  "packed",
  "shipped",
  "sold", // delivered to / bought by a customer
  "returned",
  "damaged",
  "recalled",
];

const unitSerialSchema = new mongoose.Schema(
  {
    // ORIGINATING / manufacturing company — immutable traceability root. Stays
    // set even after a unit is supplied to a seller, so recall + full-chain
    // trace by the originating company always reach the unit.
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },

    // CURRENT owner of the physical unit. A unit moves company → seller (Phase
    // 4b) without changing its serial. Existing rows are backfilled to
    // ownerType "company", ownerId = companyId (scripts/backfillUnitOwner.js).
    ownerType: { type: String, enum: ["company", "seller"], default: "company" },
    ownerId: { type: mongoose.Schema.Types.ObjectId },

    serial: { type: String, required: true, unique: true },
    qr: { type: String }, // JSON payload string: {"t":"unit","s":<serial>}

    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory", required: true },
    lotNumber: { type: String },
    batchNumber: { type: String },

    status: { type: String, enum: UNIT_STATUSES, default: "generated" },

    // LABEL print-state — INDEPENDENT of the stock `status` above. A unit can be
    // available in a warehouse (status "in_stock") yet still have an unprinted
    // label (printed:false). Set ONLY by markPrinted(), so generating serials
    // never marks them printed. The Labels page filters "Unprinted only" on this
    // flag, not on status. Defaults false (existing rows backfilled from their
    // print history — scripts/backfillUnitPrinted.js).
    printed: { type: Boolean, default: false },
    printedAt: { type: Date, default: null },

    currentLocationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
    currentShipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", default: null },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
  },
  { timestamps: true }
);

// serial already unique via field option; add query indexes.
unitSerialSchema.index({ companyId: 1, productId: 1, status: 1 });
unitSerialSchema.index({ companyId: 1, lotNumber: 1 });
unitSerialSchema.index({ companyId: 1, inventoryId: 1 });
// Owner-scoped lookups (current holder: company or seller).
unitSerialSchema.index({ ownerType: 1, ownerId: 1, status: 1 });
unitSerialSchema.index({ ownerType: 1, ownerId: 1, lotNumber: 1 });

module.exports = mongoose.model("UnitSerial", unitSerialSchema);
module.exports.UNIT_STATUSES = UNIT_STATUSES;
