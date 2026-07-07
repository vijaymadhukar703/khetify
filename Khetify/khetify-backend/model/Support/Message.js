const mongoose = require("mongoose");

// A single message inside a SupportConversation. senderType tells the UI which
// side to align the bubble on; "bot" is an automated AI/knowledge-base reply and
// "system" is reserved for auto notices (e.g. "Conversation closed") — both
// carry no senderId.
const SENDER_TYPES = ["company", "admin", "bot", "system"];

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportConversation",
      required: true,
      index: true,
    },
    senderType: { type: String, enum: SENDER_TYPES, required: true },
    // Company user id (from the company JWT) or admin id (from the admin JWT).
    // Null for "system" messages.
    senderId: { type: mongoose.Schema.Types.ObjectId },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Thread view: messages in chronological order within a conversation.
messageSchema.index({ conversationId: 1, createdAt: 1 });

const Message = mongoose.model("SupportMessage", messageSchema);
Message.SENDER_TYPES = SENDER_TYPES;

module.exports = Message;
