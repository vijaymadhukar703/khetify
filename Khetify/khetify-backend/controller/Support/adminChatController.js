const chatService = require("../../services/chatService");

// Admin-facing support chat. Guarded by requireAdmin (super_admin only), so the
// admin can read/reply to EVERY company's conversation. No company scoping here.

/**
 * GET /api/admin/chats — conversations, newest activity first.
 * Optional ?status=all|AI|WAITING_AGENT|AGENT|CLOSED filter.
 */
exports.listChats = async (req, res) => {
  try {
    const status = req.query.status || "all";
    const rows = await chatService.listConversations(status);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST /api/admin/chats/:conversationId/take — admin takes the chat (→ AGENT). */
exports.take = async (req, res) => {
  try {
    const convo = await chatService.loadConversation(req.params.conversationId);
    if (convo.status === "CLOSED") {
      return res.status(409).json({ success: false, message: "Conversation is closed" });
    }
    await chatService.takeConversation(convo, req.admin.id);
    res.json({ success: true, message: "Chat assigned", data: { _id: convo._id, status: convo.status, assignedAgentId: convo.assignedAgentId } });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ success: false, message: "Conversation not found" });
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/admin/chats/:conversationId/messages — thread for one company. */
exports.getMessages = async (req, res) => {
  try {
    await chatService.loadConversation(req.params.conversationId); // no company scope for admin
    const rows = await chatService.listMessages(req.params.conversationId);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ success: false, message: "Conversation not found" });
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST /api/admin/chats/:conversationId/reply — admin replies. */
exports.reply = async (req, res) => {
  try {
    const convo = await chatService.loadConversation(req.params.conversationId);
    const doc = await chatService.postMessage(convo, {
      senderType: "admin",
      senderId: req.admin.id,
      message: req.body.message,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ success: false, message: "Conversation not found" });
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST /api/admin/chats/:conversationId/close — admin closes the thread. */
exports.close = async (req, res) => {
  try {
    const convo = await chatService.loadConversation(req.params.conversationId);
    await chatService.closeConversation(convo);
    res.json({ success: true, message: "Conversation closed", data: { _id: convo._id, status: convo.status } });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ success: false, message: "Conversation not found" });
    res.status(500).json({ success: false, message: "Server error" });
  }
};
