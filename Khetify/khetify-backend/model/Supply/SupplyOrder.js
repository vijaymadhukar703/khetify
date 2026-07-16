const mongoose = require("mongoose");

const supplyOrderSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        quantity: { type: Number, required: true },
        unitPrice: { type: Number },
        // Direct pick/pack progress (Send Stock picks straight against the
        // reserved allocations — no PickList/wave for supply).
        pickedQty: { type: Number, default: 0 },
        packedQty: { type: Number, default: 0 },
        // Source-lot PLAN recorded at approval, from the assigned SOURCE
        // warehouse. Approval is AUTHORIZATION ONLY — it records which lot(s)
        // will fulfil the request but does NOT touch stock. Stock becomes
        // unavailable at PICK (available → reserved, tracked per lot in
        // `reservedQty`) and is committed out at DISPATCH.
        // `serials` records the labeled units picked for this order (lot-accurate).
        allocations: [
          {
            inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory" },
            lotNumber: { type: String },
            batchNumber: { type: String },
            warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" },
            // Planned qty from this lot (set at approval — no stock moved).
            qty: { type: Number },
            // Qty ACTUALLY reserved from this lot at pick. Drives the dispatch
            // commit and the release-on-cancel, so it can never double-deduct.
            reservedQty: { type: Number, default: 0 },
            committed: { type: Boolean, default: false },
            serials: { type: [String], default: [] },
          },
        ],
      },
    ],
    status: {
      type: String,
      default: "requested",
      enum: [
        "requested",
        "under_review",
        "approved",
        "picking",
        "picked",
        "packing",
        "packed",
        "rejected",
        "dispatched",
        "in_transit",
        "arrived",
        "partially_received",
        "received",
        "delivered",
        "cancelled",
      ],
    },
    shipment: {
      carrier: String,
      trackingNo: String,
      dispatchedAt: Date,
      deliveredAt: Date,
    },
    // DESTINATION (the seller's warehouse the stock lands in).
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" },
    // SOURCE (the COMPANY warehouse the company assigns at approval to fulfil from).
    sourceWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },
    // The fulfilment shipment created at approval (company → seller, scan-verified receipt).
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", default: null },
    notes: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SupplyOrder", supplyOrderSchema);
