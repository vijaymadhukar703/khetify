const mongoose = require("mongoose");

/**
 * A pick wave: the warehouse work-list to fulfil one or more confirmed orders.
 * Lines are generated from each order's stored FEFO allocations and routed by
 * bin `fullCode` (a simple S-shape walk path). Picking is scan-driven.
 */
const pickLineSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    // Polymorphic source of the line: a customer Order (default) or a seller
    // SupplyOrder. `refId` points at whichever; `orderId` is kept (set only for
    // Order lines) so existing populate("orderIds"/order) stays unchanged.
    refType: { type: String, enum: ["Order", "SupplyOrder"], default: "Order" },
    refId: { type: mongoose.Schema.Types.ObjectId },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory" },
    lotNumber: { type: String },
    fromLocationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
    fromCode: { type: String }, // denormalised fullCode for routing/display
    qty: { type: Number, required: true },
    pickedQty: { type: Number, default: 0 },
    serials: { type: [String], default: [] },
    status: { type: String, enum: ["pending", "picked", "short"], default: "pending" },
  },
  { _id: false }
);

const pickListSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" },
    waveNumber: { type: String, required: true },
    orderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
    // Seller supply orders fulfilled by this same wave (Send Stock).
    supplyOrderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "SupplyOrder" }],
    lines: [pickLineSchema],
    assignedTo: { type: mongoose.Schema.Types.ObjectId },
    status: { type: String, enum: ["open", "in_progress", "picked", "cancelled"], default: "open" },
  },
  { timestamps: true }
);

pickListSchema.index({ companyId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("PickList", pickListSchema);
