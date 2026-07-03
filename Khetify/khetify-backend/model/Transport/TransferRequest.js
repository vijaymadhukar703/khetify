const mongoose = require("mongoose");

/**
 * Inter-warehouse stock request. The DESTINATION warehouse (requester, "B")
 * asks the SOURCE warehouse ("A") for qty of a product; A's operations
 * manager accepts or rejects; B is notified of the decision (acknowledgment)
 * and the company admin is notified of every step. Fulfilment then happens
 * through the normal transfer/shipment flow (optionally linked here).
 */
const transferRequestSchema = new mongoose.Schema(
  {
    // Owner-polymorphic (company or seller). companyId kept for company rows;
    // a seller inter-warehouse request sets ownerType "seller" + ownerId.
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: false, index: true },
    ownerType: { type: String, enum: ["company", "seller"], default: "company" },
    ownerId: { type: mongoose.Schema.Types.ObjectId },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    // A — the warehouse being asked to send stock
    fromWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },
    // B — the warehouse that needs the stock (the requester)
    toWarehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true },
    qty: { type: Number, required: true, min: 1 },
    note: { type: String, maxlength: 500 },

    // How the request was initiated (seller flow). Stock always flows
    // fromWarehouseId (holder/source) → toWarehouseId (receiver); `mode` only
    // changes who INITIATES and who ACCEPTS:
    //   "push" — the SOURCE initiates ("I send my stock"); DESTINATION accepts.
    //   "pull" — the DESTINATION initiates ("I ask for stock"); the HOLDER
    //            (source) accepts. Company rows default to "push".
    mode: { type: String, enum: ["push", "pull"], default: "push" },

    status: {
      type: String,
      enum: ["requested", "accepted", "rejected", "fulfilled", "cancelled"],
      default: "requested",
      index: true,
    },

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedAt: Date,
    decisionNote: { type: String, maxlength: 500 },

    // set when the accepted request is fulfilled via a shipment/transfer
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment" },
  },
  { timestamps: true }
);

transferRequestSchema.index({ companyId: 1, fromWarehouseId: 1, status: 1 });
transferRequestSchema.index({ companyId: 1, toWarehouseId: 1, status: 1 });
transferRequestSchema.index({ ownerType: 1, ownerId: 1, status: 1 });

module.exports = mongoose.model("TransferRequest", transferRequestSchema);
