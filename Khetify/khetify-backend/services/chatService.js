const Conversation = require("../model/Support/Conversation");
const Message = require("../model/Support/Message");
const Company = require("../model/Company/Company");
const supportBot = require("./supportBotService");
const { emitToCompany, emitToAdmins } = require("../sockets");

// Business logic for the live company↔admin support chat. Every company-facing
// query is scoped by companyId so one tenant can never read another's thread.

// A conversation is "active" (can take new company messages) unless it's CLOSED.
// "OPEN" is the legacy Phase-1 active status, treated like "AI".
const isClosed = (convo) => convo.status === "CLOSED";
const isAiStage = (convo) => convo.status === "AI" || convo.status === "OPEN";

/**
 * Return the company's ACTIVE conversation, creating a fresh AI one when the
 * latest thread is CLOSED (or none exists). A CLOSED conversation is never
 * reused — it stays as history and a new thread takes over. Backs both
 * POST /chat/start and POST /chat/start-new.
 */
async function getOrCreateActiveConversation(companyId) {
  const latest = await Conversation.findOne({ companyId }).sort({ createdAt: -1 });
  if (latest && !isClosed(latest)) return latest;
  return Conversation.create({ companyId, status: "AI" }); // chats begin in AI mode
}

/** The company's LATEST conversation (OPEN or CLOSED), or null if none. */
async function getMyConversation(companyId) {
  return Conversation.findOne({ companyId }).sort({ createdAt: -1 }).lean();
}

/**
 * Load a conversation and assert it belongs to `companyId`. Throws a tagged
 * error the controller maps to 404/403. Pass companyId=null to skip the check
 * (admin path).
 */
async function loadConversation(conversationId, companyId = null) {
  const convo = await Conversation.findById(conversationId);
  if (!convo) {
    const err = new Error("Conversation not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (companyId && String(convo.companyId) !== String(companyId)) {
    const err = new Error("Forbidden");
    err.code = "FORBIDDEN";
    throw err;
  }
  return convo;
}

/** Messages in a conversation, oldest first. */
async function listMessages(conversationId) {
  return Message.find({ conversationId }).sort({ createdAt: 1 }).lean();
}

/**
 * Append a message and refresh the conversation preview. Emits the new message
 * to the company room and the admin inbox in realtime.
 *   senderType: "company" | "admin" | "system"
 */
async function postMessage(convo, { senderType, senderId, message }) {
  const doc = await Message.create({
    conversationId: convo._id,
    senderType,
    senderId: senderId || undefined,
    message,
  });

  convo.lastMessage = message.slice(0, 200);
  convo.lastMessageAt = doc.createdAt;
  convo.lastActivityAt = doc.createdAt; // resets the inactivity timer (req 5/10)
  await convo.save();                     // timestamps → updatedAt refreshed too

  const payload = { message: doc.toObject(), conversationId: String(convo._id) };
  // Company side (both owner + team sessions share the company:<id> room).
  emitToCompany(convo.companyId, "chat:message", payload);
  // Admin inbox: the message + a nudge to re-sort the conversation list.
  emitToAdmins("chat:message", payload);
  emitToAdmins("chat:updated", { conversationId: String(convo._id) });

  return doc;
}

/** Broadcast a status change to the company widget + the admin inbox. */
function emitStatus(convo) {
  const payload = { conversationId: String(convo._id), status: convo.status };
  emitToCompany(convo.companyId, "chat:status", payload);
  emitToAdmins("chat:status", payload);
  emitToAdmins("chat:updated", { conversationId: String(convo._id) });
}

// System notices posted when a chat is escalated to a human.
const TRANSFER_MSG = {
  // Out-of-FAQ / low-confidence question (req 8).
  no_faq_match:
    "The answer to this question is not currently available. Your chat has been transferred to admin support. Please wait for an agent.",
  // User explicitly asked for a human ("Talk to Admin" / agent).
  requested_human:
    "The chat has been transferred to admin support. Please wait for an agent.",
  default: "Your chat has been transferred to admin support. Please wait for an agent.",
};

/**
 * Move a conversation into the human queue and notify both sides. `reason`
 * (no_faq_match | requested_human) selects the system message shown to the user.
 */
async function transferToAgent(convo, reason = "default") {
  if (convo.status === "WAITING_AGENT" || convo.status === "AGENT") return convo;
  convo.status = "WAITING_AGENT";
  await convo.save();
  await postMessage(convo, {
    senderType: "system",
    senderId: null,
    message: TRANSFER_MSG[reason] || TRANSFER_MSG.default,
  });
  emitStatus(convo);
  return convo;
}

/**
 * Handle a company message end-to-end:
 *   1. persist the company message
 *   2. if the conversation is in the AI stage, either answer from the knowledge
 *      base (confident) OR escalate to WAITING_AGENT (human requested / unsure)
 *   3. WAITING_AGENT / AGENT stages just queue the message for the admin — the
 *      bot stays silent so a human owns the thread.
 * Returns the company message (bot/system replies stream in over the socket).
 */
async function handleCompanyMessage(convo, { senderId, message }) {
  const companyMsg = await postMessage(convo, { senderType: "company", senderId, message });

  if (!isAiStage(convo)) return companyMsg; // WAITING_AGENT / AGENT → admin handles

  const result = supportBot.evaluate(message);

  // Approval/registration-timing question → answer from the company's REAL
  // status (never a guessed time). Rejected-without-reason routes to a human.
  if (result.needsCompany) {
    const company = await Company.findById(convo.companyId).select("status").lean();
    const ans = supportBot.approvalReply(company?.status || "pending");
    await postMessage(convo, { senderType: "bot", senderId: null, message: ans.reply });
    if (ans.escalate) await transferToAgent(convo, "requested_human");
    return companyMsg;
  }

  if (result.escalate) {
    // requested_human → user asked for a person; no_faq_match → out-of-FAQ question.
    await transferToAgent(convo, result.reason);
  } else {
    await postMessage(convo, { senderType: "bot", senderId: null, message: result.reply });
  }
  return companyMsg;
}

/**
 * Admin: take a WAITING (or AI) chat. Assigns the agent, flips to AGENT so the
 * bot no longer replies, and posts a system notice.
 */
async function takeConversation(convo, adminId) {
  convo.status = "AGENT";
  convo.assignedAgentId = adminId;
  await convo.save();
  await postMessage(convo, {
    senderType: "system",
    senderId: null,
    message: "An agent has joined the conversation.",
  });
  emitStatus(convo);
  return convo;
}

/**
 * Admin inbox: conversations filtered by status, most-recent activity first,
 * with the company name resolved. No dummy data — pulls the real Company doc.
 * `statusFilter`: "all" | "AI" | "WAITING_AGENT" | "AGENT" | "CLOSED".
 */
async function listConversations(statusFilter = "all") {
  const query = {};
  if (statusFilter && statusFilter !== "all") {
    // Legacy "OPEN" threads are surfaced under the "AI" filter.
    query.status = statusFilter === "AI" ? { $in: ["AI", "OPEN"] } : statusFilter;
  }
  const convos = await Conversation.find(query)
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean();

  const ids = convos.map((c) => c.companyId);
  const companies = await Company.find({ _id: { $in: ids } })
    .select("fullName email companyInfo.companyName")
    .lean();
  const nameById = new Map(
    companies.map((c) => [
      String(c._id),
      c.companyInfo?.companyName || c.fullName || c.email || "Company",
    ])
  );

  return convos.map((c) => ({
    ...c,
    companyName: nameById.get(String(c.companyId)) || "Company",
  }));
}

// Statuses that can still be auto-closed (everything except CLOSED). Legacy
// "OPEN" is included so pre-Phase-2 threads also time out.
const ACTIVE_STATUSES = ["AI", "OPEN", "WAITING_AGENT", "AGENT"];
// Inactivity window before a silent thread is auto-closed.
const INACTIVITY_MS = 10 * 60 * 1000; // 10 minutes
const INACTIVITY_CLOSE_MSG =
  "This chat was automatically closed because there was no activity for 10 minutes. You can start a new chat whenever you need assistance.";

/** Broadcast a close (with reason) to both the company widget and admin inbox. */
function emitClosed(convo, reason) {
  const payload = { conversationId: String(convo._id), reason };
  emitToCompany(convo.companyId, "chat:closed", payload);
  emitToAdmins("chat:closed", payload);
  emitStatus(convo); // keep the AI/WAITING/AGENT/CLOSED pills in sync everywhere
}

/** Admin: close a conversation. Adds a system message so both sides see it. */
async function closeConversation(convo, adminId = null) {
  convo.status = "CLOSED";
  convo.closedAt = new Date();
  convo.closedBy = "admin";
  convo.closeReason = "MANUAL";
  await convo.save();
  await postMessage(convo, {
    senderType: "system",
    senderId: null,
    message: "This conversation was closed by support.",
  });
  emitClosed(convo, "MANUAL");
  return convo;
}

/**
 * Inactivity sweep (called every minute by the cron worker). Closes every still-
 * active conversation whose last activity is older than INACTIVITY_MS.
 *
 * The status flip is ATOMIC (findOneAndUpdate gated on an active status), so:
 *   • two overlapping sweeps can never both close the same thread, and
 *   • the closing system message is posted EXACTLY once per conversation.
 * A thread that receives a message before the cutoff has its lastActivityAt
 * refreshed by postMessage, so it is skipped — the timer effectively resets.
 * Returns the number of conversations closed.
 */
async function closeInactiveConversations(now = new Date()) {
  const cutoff = new Date(now.getTime() - INACTIVITY_MS);
  // Match on lastActivityAt; fall back to updatedAt for legacy docs that predate
  // the field so they still time out instead of lingering forever.
  const stale = await Conversation.find({
    status: { $in: ACTIVE_STATUSES },
    $or: [
      { lastActivityAt: { $lte: cutoff } },
      { lastActivityAt: { $exists: false }, updatedAt: { $lte: cutoff } },
    ],
  })
    .select("_id")
    .lean();

  let closed = 0;
  for (const { _id } of stale) {
    // Atomic claim: only the pass that flips it away from an active status wins.
    const convo = await Conversation.findOneAndUpdate(
      { _id, status: { $in: ACTIVE_STATUSES } },
      { $set: { status: "CLOSED", closedAt: now, closedBy: "system", closeReason: "INACTIVITY_TIMEOUT" } },
      { new: true }
    );
    if (!convo) continue; // already closed / claimed by another pass — skip (no dup message)
    try {
      await postMessage(convo, {
        senderType: "system",
        senderId: null,
        message: INACTIVITY_CLOSE_MSG,
      });
      emitClosed(convo, "INACTIVITY_TIMEOUT");
      closed += 1;
    } catch (err) {
      // Don't let one bad thread abort the whole sweep.
      console.error("auto-close post failed:", convo._id, err.message);
    }
  }
  return closed;
}

module.exports = {
  getOrCreateActiveConversation,
  getMyConversation,
  loadConversation,
  listMessages,
  postMessage,
  handleCompanyMessage,
  transferToAgent,
  takeConversation,
  listConversations,
  closeConversation,
  closeInactiveConversations,
  INACTIVITY_MS,
};
