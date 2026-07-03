const mongoose = require("mongoose");

// Non-terminal statuses — at most one such application per (seller, company).
const ACTIVE_STATUSES = [
  "applied", "under_review", "need_more_docs", "approved",
  "agreement_pending", "agreement_signed", "pc_issued", "govt_pending", "govt_approved", "active",
];

const timelineSchema = new mongoose.Schema(
  {
    status: { type: String },
    at: { type: Date, default: Date.now },
    byType: { type: String, enum: ["seller", "company", "system"], default: "system" },
    byId: { type: mongoose.Schema.Types.ObjectId },
    note: { type: String },
  },
  { _id: false }
);

/**
 * A seller's request to become an authorized reseller of a specific company's
 * products. Drives the full PC lifecycle. Owner: sellerId; addressed to
 * companyId (the reviewing company).
 */
const pcApplicationSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    status: {
      type: String,
      enum: [...ACTIVE_STATUSES, "rejected", "cancelled", "revoked"],
      default: "applied",
    },
    productCategories: [{ type: String }],
    businessSnapshot: {
      businessName: String,
      gstin: String,
      pan: String,
      address: String,
      licenses: [String],
    },
    // Answers to the company's configurable PC form (key → value), plus an
    // immutable snapshot of the form fields at submission time so the company
    // can render labels/order exactly as the seller saw them.
    formAnswers: { type: mongoose.Schema.Types.Mixed, default: {} },
    formSnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
    documentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "SellerDocument" }],
    requestedDocs: [{ type: String }],
    reviewedBy: { type: mongoose.Schema.Types.ObjectId },
    reviewedAt: { type: Date },
    decisionNote: { type: String },
    rejectionReason: { type: String },
    timeline: { type: [timelineSchema], default: [] },
  },
  { timestamps: true }
);

pcApplicationSchema.index({ sellerId: 1, companyId: 1 });
pcApplicationSchema.index({ companyId: 1, status: 1 });

pcApplicationSchema.statics.ACTIVE_STATUSES = ACTIVE_STATUSES;

module.exports = mongoose.model("PCApplication", pcApplicationSchema);
