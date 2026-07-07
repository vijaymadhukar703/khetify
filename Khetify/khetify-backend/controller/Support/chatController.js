const chatService = require("../../services/chatService");

// Company-facing support chat. Scope is ALWAYS the token's companyId — the
// client never supplies it. Controllers parse req, call the service, shape JSON.

/**
 * POST /api/chat/start — return the caller's ACTIVE conversation, creating a
 * fresh OPEN one if the latest is CLOSED (or none exists yet).
 */
exports.startConversation = async (req, res) => {
  try {
    const convo = await chatService.getOrCreateActiveConversation(req.user.companyId);
    res.status(201).json({ success: true, data: convo });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/chat/start-new — explicitly start a new chat. If an OPEN thread
 * already exists it is returned (no duplicate); otherwise a fresh OPEN
 * conversation is created. The previous CLOSED thread is kept as history.
 */
exports.startNewConversation = async (req, res) => {
  try {
    const convo = await chatService.getOrCreateActiveConversation(req.user.companyId);
    res.status(201).json({ success: true, data: convo });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/chat/my-conversation — the caller's conversation, or null. */
exports.getMyConversation = async (req, res) => {
  try {
    const convo = await chatService.getMyConversation(req.user.companyId);
    res.json({ success: true, data: convo || null });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/chat/:conversationId/messages — messages of the caller's thread. */
exports.getMessages = async (req, res) => {
  try {
    await chatService.loadConversation(req.params.conversationId, req.user.companyId);
    const rows = await chatService.listMessages(req.params.conversationId);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ success: false, message: "Conversation not found" });
    if (err.code === "FORBIDDEN") return res.status(403).json({ success: false, message: "Forbidden" });
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST /api/chat/:conversationId/message — company sends a message. */
exports.postMessage = async (req, res) => {
  try {
    const convo = await chatService.loadConversation(req.params.conversationId, req.user.companyId);
    if (convo.status === "CLOSED") {
      return res.status(409).json({ success: false, message: "This conversation is closed. Please start a new chat." });
    }
    // Persists the company message, then runs the AI/escalation flow (bot reply
    // or transfer to a human) — extra messages stream to the client via socket.
    const doc = await chatService.handleCompanyMessage(convo, {
      senderId: req.user.id,
      message: req.body.message,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ success: false, message: "Conversation not found" });
    if (err.code === "FORBIDDEN") return res.status(403).json({ success: false, message: "Forbidden" });
    res.status(500).json({ success: false, message: "Server error" });
  }
};
