const express = require("express");
const router = express.Router();
const { z } = require("zod");

const {
  listChats,
  getMessages,
  take,
  reply,
  close,
} = require("../../controller/Support/adminChatController");
const requireAdmin = require("../../middlewares/requireAdmin");
const validate = require("../../middlewares/validate");

const replySchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(2000),
});

// Platform-admin only (super_admin). Mounted at /api/admin/chats.
router.get("/", requireAdmin, listChats);
router.get("/:conversationId/messages", requireAdmin, getMessages);
router.post("/:conversationId/take", requireAdmin, take);
router.post("/:conversationId/reply", requireAdmin, validate({ body: replySchema }), reply);
router.post("/:conversationId/close", requireAdmin, close);

module.exports = router;
