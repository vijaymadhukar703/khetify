const mongoose = require("mongoose");

/**
 * A packed carton for an order. Each scanned serial is verified to belong to
 * the order's allocation before it goes in (mis-pick guard). packageNumber
 * doubles as the carton barcode.
 */
const packageItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    qty: { type: Number, required: true },
    serials: { type: [String], default: [] },
  },
  { _id: false }
);

const packageSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    // Set for customer-order packages (unchanged). Null for seller-supply
    // packages, which carry refType/refId instead.
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    // Polymorphic source: a customer Order (default) or a seller SupplyOrder.
    refType: { type: String, enum: ["Order", "SupplyOrder"], default: "Order" },
    refId: { type: mongoose.Schema.Types.ObjectId },
    packageNumber: { type: String, required: true }, // PKG-YYYYMM-#### (= barcode)
    items: [packageItemSchema],
    weightKg: { type: Number },
    dims: { type: String }, // "LxWxH cm"
    status: { type: String, enum: ["packed", "shipped"], default: "packed" },
    packedBy: { type: mongoose.Schema.Types.ObjectId },
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", default: null },
  },
  { timestamps: true }
);

packageSchema.index({ companyId: 1, packageNumber: 1 }, { unique: true });
packageSchema.index({ companyId: 1, orderId: 1 });

module.exports = mongoose.model("Package", packageSchema);
