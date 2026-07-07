const express = require("express");
const router = express.Router();
const { z } = require("zod");

const {
  startConversation,
  startNewConversation,
  getMyConversation,
  getMessages,
  postMessage,
} = require("../../controller/Support/chatController");
const authMiddleware = require("../../middlewares/authMiddlewares");
const validate = require("../../middlewares/validate");

const messageSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(2000),
});

// All routes are company-scoped via the JWT (req.user.companyId).
router.post("/start", authMiddleware, startConversation);
router.post("/start-new", authMiddleware, startNewConversation);
router.get("/my-conversation", authMiddleware, getMyConversation);
router.get("/:conversationId/messages", authMiddleware, getMessages);
router.post("/:conversationId/message", authMiddleware, validate({ body: messageSchema }), postMessage);

module.exports = router;
