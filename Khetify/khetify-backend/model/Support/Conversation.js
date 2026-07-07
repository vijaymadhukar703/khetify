const mongoose = require("mongoose");

// A live support conversation between ONE company and the platform admin.
// Company-scoped (one active thread per company). Distinct from SupportTicket
// (formal, categorised requests) — this is the realtime chat channel.
//
// Phase 2 lifecycle:
//   AI            → the bot answers common questions automatically
//   WAITING_AGENT → escalated; queued for a human admin to pick up
//   AGENT         → an admin has taken the chat; the bot no longer replies
//   CLOSED        → resolved (kept as history)
// "OPEN" is a legacy Phase-1 status, still accepted so pre-Phase-2 threads
// validate; treated as an active (AI-eligible) state everywhere.
const CONVERSATION_STATUSES = ["AI", "WAITING_AGENT", "AGENT", "CLOSED"];
const ALL_STATUSES = [...CONVERSATION_STATUSES, "OPEN"];

const conversationSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    status: { type: String, enum: ALL_STATUSES, default: "AI", index: true },
    // The admin who took the chat (set when status → AGENT). Null while AI/WAITING.
    assignedAgentId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    // Denormalised preview for the admin inbox list (avoids a per-row message join).
    lastMessage: { type: String, default: "" },
    lastMessageAt: { type: Date },
    // Last time ANY party (company/bot/admin/system) touched the thread. Drives
    // the 10-minute inactivity auto-close worker; refreshed on every postMessage.
    lastActivityAt: { type: Date, default: Date.now, index: true },
    // Set when the thread moves to CLOSED (manual admin close or auto-close).
    closedAt: { type: Date },
    closedBy: { type: String, enum: ["admin", "system", "company"], default: undefined },
    closeReason: { type: String, enum: ["MANUAL", "INACTIVITY_TIMEOUT"], default: undefined },
  },
  { timestamps: true } // createdAt + updatedAt
);

// Admin inbox: newest activity first.
conversationSchema.index({ status: 1, lastMessageAt: -1 });
// Inactivity sweep: find still-active threads whose last activity is stale.
conversationSchema.index({ status: 1, lastActivityAt: 1 });

const Conversation = mongoose.model("SupportConversation", conversationSchema);
Conversation.CONVERSATION_STATUSES = CONVERSATION_STATUSES; // canonical (excludes legacy OPEN)
Conversation.ALL_STATUSES = ALL_STATUSES;

module.exports = Conversation;
