const mongoose = require("mongoose");

/**
 * Transactional outbox: one row per (event, target endpoint), written in the
 * SAME transaction as the business change. A cron dispatcher delivers them with
 * HMAC signing and exponential backoff, so a callback is never lost and never
 * fires for a rolled-back change.
 */
const outboxEventSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    endpointId: { type: mongoose.Schema.Types.ObjectId, ref: "WebhookEndpoint", required: true },
    event: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed },
    status: { type: String, enum: ["pending", "delivered", "failed"], default: "pending" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lastError: { type: String },
    deliveredAt: { type: Date },
  },
  { timestamps: true }
);

outboxEventSchema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model("OutboxEvent", outboxEventSchema);
