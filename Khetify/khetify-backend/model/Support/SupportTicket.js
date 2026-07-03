const mongoose = require("mongoose");

// A company-raised support ticket. Scoped by companyId (multi-tenant) and given
// a human-friendly, per-company sequential ticketId (e.g. "REQ-1") allocated via
// counterService. Status follows the support lifecycle; admins move it forward.
const SUPPORT_CATEGORIES = [
  "Product Upload",
  "Inventory & Stock",
  "Orders",
  "Warehouses & Operations",
  "Sellers / Dealers",
  "Returns",
  "Billing & Subscription",
  "Account & Settings",
  "Other",
];

const SUPPORT_STATUSES = ["open", "in_review", "resolved", "closed"];

const supportTicketSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    ticketId: { type: String, required: true }, // e.g. "REQ-1" (unique per company)
    category: { type: String, enum: SUPPORT_CATEGORIES, required: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    status: { type: String, enum: SUPPORT_STATUSES, default: "open" },
    // Who raised it (from the JWT). Optional so legacy/company-owner tokens work.
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

supportTicketSchema.index({ companyId: 1, createdAt: -1 });
supportTicketSchema.index({ companyId: 1, ticketId: 1 }, { unique: true });

const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);
SupportTicket.SUPPORT_CATEGORIES = SUPPORT_CATEGORIES;
SupportTicket.SUPPORT_STATUSES = SUPPORT_STATUSES;

module.exports = SupportTicket;
