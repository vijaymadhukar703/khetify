const mongoose = require("mongoose");

/**
 * Goods Receipt Note — the controlled inbound gate. Goods are counted and
 * QC'd against an expectation (a PO / supply order / return) BEFORE they
 * become sellable stock. postGRN() is what actually creates lots.
 *
 * Lifecycle: draft → received → (qc) → putaway_pending → completed
 *            (cancelled at any point before completed)
 */
const grnLineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: { type: String }, // display hint when prefilled from a PO line w/o product link
    expectedQty: { type: Number, default: 0 },
    receivedQty: { type: Number, default: 0 },
    acceptedQty: { type: Number, default: 0 },
    rejectedQty: { type: Number, default: 0 },
    rejectReason: { type: String },
    lotNumber: { type: String },
    batchNumber: { type: String },
    mfgDate: { type: Date },
    expiryDate: { type: Date },
    mrp: { type: Number },
    unitCost: { type: Number },
  },
  { _id: false }
);

const grnSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    grnNumber: { type: String, required: true }, // GRN-YYYYMM-#### (Counter-backed)

    refType: { type: String, enum: ["PurchaseOrder", "SupplyOrder", "Return", "Manual"], default: "Manual" },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },

    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },

    status: {
      type: String,
      enum: ["draft", "received", "qc_pending", "putaway_pending", "completed", "cancelled"],
      default: "draft",
    },

    lines: [grnLineSchema],

    receivedBy: { type: mongoose.Schema.Types.ObjectId },
    qcBy: { type: mongoose.Schema.Types.ObjectId },
    vehicleNo: { type: String },
    lrNumber: { type: String },
    invoiceNo: { type: String },
    notes: { type: String },
    postedAt: { type: Date },
  },
  { timestamps: true }
);

grnSchema.index({ companyId: 1, grnNumber: 1 }, { unique: true });
grnSchema.index({ companyId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("GRN", grnSchema);
