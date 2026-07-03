const mongoose = require("mongoose");

/** A customer-registered URL to receive signed event callbacks. */
const webhookEndpointSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    url: { type: String, required: true },
    secret: { type: String, required: true }, // HMAC signing secret
    events: { type: [String], default: [] }, // inventory.updated | order.created | shipment.delivered
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

webhookEndpointSchema.index({ companyId: 1, isActive: 1 });

module.exports = mongoose.model("WebhookEndpoint", webhookEndpointSchema);
