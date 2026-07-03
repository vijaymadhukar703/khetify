const mongoose = require("mongoose");

/**
 * Generic, append-only audit trail for NON-stock actions (role changes,
 * shipment verification, adjustment approvals, recalls, price edits, ...).
 *
 * Stock movements have their own ledger (StockMovement). This collection
 * captures everything else that an auditor needs to reconstruct "who did
 * what, when, and what changed". Never update or delete rows here.
 */
const auditLogSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId }, // user/company id from JWT
    actorRole: { type: String },
    action: { type: String, required: true }, // e.g. "user.role_changed", "shipment.verified"
    entityType: { type: String }, // "User" | "Shipment" | "Adjustment" | ...
    entityId: { type: mongoose.Schema.Types.ObjectId },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
    note: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ companyId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
