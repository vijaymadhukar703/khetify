const mongoose = require("mongoose");

/**
 * A customer of the company. Sales link to this for traceability, repeat-order
 * history, GST invoicing and recall outreach. Deduped per company by phone.
 */
const addressSchema = new mongoose.Schema(
  {
    label: { type: String }, // "Billing", "Shipping", "Farm", ...
    line1: { type: String },
    city: { type: String },
    district: { type: String },
    state: { type: String },
    stateCode: { type: String }, // GST state code, e.g. "23" (MP)
    pincode: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false }
);

const customerSchema = new mongoose.Schema(
  {
    // Owner is polymorphic: a customer belongs to EITHER a company OR a seller.
    // companyId is kept (no longer required) for backward compatibility; the
    // canonical owner is (ownerType, ownerId), always set (validator below).
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: false },
    ownerType: { type: String, enum: ["company", "seller"], default: "company" },
    ownerId: { type: mongoose.Schema.Types.ObjectId },

    customerCode: { type: String }, // CUST-#### (per owner)
    name: { type: String, required: true },
    // "retail" = end customer, "business" = business buyer, "dealer" = a
    // downstream reseller/retailer (used by sellers). Additive — existing
    // company values are unchanged.
    type: { type: String, enum: ["retail", "business", "dealer"], default: "retail" },
    phone: { type: String },
    email: { type: String },
    gstin: { type: String }, // validated at the route layer
    addresses: { type: [addressSchema], default: [] },
    creditLimit: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Dedup per OWNER on phone (sparse so phone-less customers are allowed) — the
// same phone may exist under different owners (a company and a seller, or two
// sellers). Existing company rows are backfilled to ownerType "company",
// ownerId = companyId so their dedup keeps holding.
customerSchema.index({ ownerType: 1, ownerId: 1, phone: 1 }, { unique: true, sparse: true });
customerSchema.index({ ownerType: 1, ownerId: 1, name: 1 });

// The owner (ownerType + ownerId) must always be identified.
customerSchema.pre("validate", function () {
  if (!this.ownerType || !this.ownerId) {
    throw new Error("A customer must have an owner (ownerType + ownerId)");
  }
});

module.exports = mongoose.model("Customer", customerSchema);
