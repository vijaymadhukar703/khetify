const mongoose = require("mongoose");

/**
 * An API key for machine-to-machine access to /api/integrations/*. Only the
 * SHA-256 hash is stored — the plaintext is shown to the user exactly once at
 * creation. `prefix` (first chars) is kept for display/identification.
 */
const apiKeySchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true },
    prefix: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true },
    scopes: { type: [String], default: ["pos:sync"] }, // pos:sync | orders:write | inventory:read
    lastUsedAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

apiKeySchema.index({ companyId: 1, isActive: 1 });

module.exports = mongoose.model("ApiKey", apiKeySchema);
