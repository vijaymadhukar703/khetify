const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    // Owner is polymorphic: a subscription belongs to EITHER a company OR a
    // seller. companyId kept (no longer required/unique) for backward
    // compatibility; the canonical owner is (ownerType, ownerId).
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: false,
    },
    ownerType: { type: String, enum: ["company", "seller"], default: "company" },
    ownerId: { type: mongoose.Schema.Types.ObjectId },
    plan: {
      type: String,
      enum: ["free", "pro", "enterprise"],
      default: "free",
    },
    status: {
      type: String,
      enum: ["active", "past_due", "canceled"],
      default: "active",
    },
    // Denormalized at write-time from config/plans.js so reads are cheap.
    features: [{ type: String }],
    limits: {
      warehouses: Number,
      products: Number,
      sellers: Number,
      customers: Number,
    },
    currentPeriodEnd: { type: Date },
    provider: { type: String }, // e.g. "razorpay" | "stripe"
    providerSubscriptionId: { type: String },
  },
  { timestamps: true }
);

// One subscription per owner (company or seller).
subscriptionSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Subscription", subscriptionSchema);
