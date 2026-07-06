const mongoose = require("mongoose");

/**
 * A public storefront shopper (customer-shop). This is a GLOBAL end-consumer
 * account — distinct from:
 *   - User        (a team member owned by a company/seller),
 *   - Sales/Customer (an owner-scoped CRM record; one is auto-created per seller
 *                     when a consumer places an order with that seller).
 *
 * A consumer browses every seller's published listings without logging in and
 * only authenticates at checkout. Auth is email/phone + password; email OTP
 * (via mailerService) optionally verifies the email. No SMS is sent — phone is
 * stored as contact info only.
 */
const shopAddressSchema = new mongoose.Schema(
  {
    label: { type: String }, // "Home", "Work", ...
    fullName: { type: String },
    phone: { type: String },
    line1: { type: String },
    line2: { type: String },
    city: { type: String },
    district: { type: String },
    state: { type: String },
    stateCode: { type: String }, // GST state code, e.g. "23" (MP)
    pincode: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

const consumerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true },

    emailVerified: { type: Boolean, default: false },
    // Short-lived email OTP for verification (hash + expiry; never store raw).
    emailOtp: {
      codeHash: { type: String },
      expiresAt: { type: Date },
      attempts: { type: Number, default: 0 },
    },

    addresses: { type: [shopAddressSchema], default: [] },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// A consumer logs in by email OR phone; both are unique when present (sparse so
// an account may carry only one of them).
consumerSchema.index({ email: 1 }, { unique: true, sparse: true });
consumerSchema.index({ phone: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Consumer", consumerSchema);
