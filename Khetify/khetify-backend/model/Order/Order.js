const mongoose = require("mongoose");

/**
 * A customer order placed against a company's catalogue.
 * Revenue / units-sold / returns on the dashboard are computed from these rows.
 *
 * Sprint 4 additions are ALL additive — legacy fields (customerName, channel,
 * items[].name/qty/price) keep working for the existing marketplace flow.
 */

// FEFO allocation recorded per line at order confirm (reservation). Serials are
// filled during picking (Sprint 4.2) for serial-tracked products.
const allocationSchema = new mongoose.Schema(
  {
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Inventory" },
    lotNumber: { type: String },
    batchNumber: { type: String },
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse" },
    qty: { type: Number },
    committed: { type: Boolean, default: false }, // set true on dispatch
    serials: { type: [String], default: [] },
  },
  { _id: false }
);

const taxSchema = new mongoose.Schema(
  {
    hsnCode: { type: String },
    gstRate: { type: Number, default: 0 },
    taxable: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
  },
  { _id: false }
);

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: { type: String },
    qty: { type: Number, required: true },
    price: { type: Number, required: true }, // unit price at time of sale
    pickedQty: { type: Number, default: 0 }, // direct-pick progress (no wave)
    allocations: { type: [allocationSchema], default: [] },
    taxes: { type: taxSchema, default: undefined },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    // Owner is polymorphic: an order belongs to EITHER a company OR a seller.
    // companyId is kept (no longer required) for backward compatibility; the
    // canonical owner is (ownerType, ownerId), always set (validator below).
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: false },
    ownerType: { type: String, enum: ["company", "seller"], default: "company" },
    ownerId: { type: mongoose.Schema.Types.ObjectId },

    orderNumber: { type: String },
    invoiceNumber: { type: String }, // INV-<FY>-#### (gapless per owner)

    // Legacy denormalised name kept; customerId is the new source of truth.
    customerName: { type: String },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    // Public storefront shopper who placed this order (salesChannel "website").
    // Additive: null for all existing/company/seller-created orders.
    consumerId: { type: mongoose.Schema.Types.ObjectId, ref: "Consumer", default: null },
    billingAddress: { type: mongoose.Schema.Types.Mixed },
    shippingAddress: { type: mongoose.Schema.Types.Mixed },

    items: [orderItemSchema],
    totalUnits: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },

    channel: { type: String, enum: ["online", "offline"], default: "online" }, // legacy
    salesChannel: { type: String, enum: ["pos", "website", "shopify", "amazon", "flipkart", "manual", "b2b"], default: "manual" },
    payment: {
      mode: { type: String }, // cash | upi | card | credit | ...
      status: { type: String, enum: ["pending", "paid", "partial", "refunded"], default: "pending" },
      txnRef: { type: String },
    },

    status: {
      type: String,
      enum: ["pending", "confirmed", "packed", "shipped", "delivered", "returned", "cancelled"],
      default: "pending",
    },

    placedAt: { type: Date, default: Date.now },
    dispatchedAt: { type: Date },
  },
  { timestamps: true }
);

// Legacy company indexes (kept) + owner-aware indexes.
orderSchema.index({ companyId: 1, placedAt: -1 });
orderSchema.index({ companyId: 1, status: 1 });
orderSchema.index({ companyId: 1, invoiceNumber: 1 });
orderSchema.index({ ownerType: 1, ownerId: 1, placedAt: -1 });
orderSchema.index({ ownerType: 1, ownerId: 1, status: 1 });
orderSchema.index({ ownerType: 1, ownerId: 1, invoiceNumber: 1 });
orderSchema.index({ consumerId: 1, placedAt: -1 }); // storefront: a shopper's order history

// The owner (ownerType + ownerId) must always be identified. Legacy/company
// callers that set only companyId are auto-derived to ownerType "company",
// ownerId = companyId — so existing order creation stays unchanged.
orderSchema.pre("validate", function () {
  if (!this.ownerId && this.companyId) {
    this.ownerType = this.ownerType || "company";
    this.ownerId = this.companyId;
  }
  if (!this.ownerType || !this.ownerId) {
    throw new Error("An order must have an owner (ownerType + ownerId)");
  }
});

module.exports = mongoose.model("Order", orderSchema);
