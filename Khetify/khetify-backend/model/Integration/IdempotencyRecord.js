const mongoose = require("mongoose");

/**
 * Stores the result of a processed idempotency key so a replay (same
 * externalId) returns the original outcome instead of double-processing.
 * Auto-expires after 30 days via a TTL index.
 */
const idempotencyRecordSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    key: { type: String, required: true }, // the external idempotency key
    responseHash: { type: String },
    response: { type: mongoose.Schema.Types.Mixed }, // stored result returned on replay
    createdAt: { type: Date, default: Date.now },
  }
);

idempotencyRecordSchema.index({ companyId: 1, key: 1 }, { unique: true });
idempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 }); // TTL 30d

module.exports = mongoose.model("IdempotencyRecord", idempotencyRecordSchema);
