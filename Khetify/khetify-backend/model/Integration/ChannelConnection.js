const mongoose = require("mongoose");

/**
 * A connection to an external sales channel. Credentials are stored ENCRYPTED
 * (AES-256-GCM, see services/cryptoUtil.js) — never in plaintext.
 */
const channelConnectionSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    channel: { type: String, enum: ["shopify", "woocommerce", "amazon", "flipkart"], required: true },
    credentials: { type: String }, // encrypted blob
    locationMapping: { type: mongoose.Schema.Types.Mixed, default: {} }, // externalLocationId → warehouseId
    syncState: { type: mongoose.Schema.Types.Mixed, default: {} }, // cursors, lastSyncAt, ...
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

channelConnectionSchema.index({ companyId: 1, channel: 1 }, { unique: true });

module.exports = mongoose.model("ChannelConnection", channelConnectionSchema);
