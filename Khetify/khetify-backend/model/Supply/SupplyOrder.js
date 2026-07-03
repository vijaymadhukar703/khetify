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
        // FEFO reservation made at approval, from the assigned SOURCE warehouse.
        // Mirrors an Order line's allocations so the SAME pick/pack/dispatch
        // rails (Send Stock) can fulfil a supply order. Committed at dispatch.
        // `serials` records the labeled units picked for this order (lot-accurate).
        allocations: [
          {
            inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory" },
            lotNumber: { type: String },
            batchNumber: { type: String },
            warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" },
            qty: { type: Number },
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
