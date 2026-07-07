const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Conversation = require("../model/Support/Conversation");
const Message = require("../model/Support/Message");
const chatService = require("../services/chatService");

let companyId;

beforeEach(async () => {
  const company = await Company.create({
    fullName: "Idle Co",
    email: `idle-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x",
  });
  companyId = company._id;
});

// Helper: create a conversation and backdate its inactivity clock.
const makeConvo = (status, minutesIdle) =>
  Conversation.create({
    companyId,
    status,
    lastActivityAt: new Date(Date.now() - minutesIdle * 60 * 1000),
  });

const sysMessages = (convoId) =>
  Message.find({ conversationId: convoId, senderType: "system" }).lean();

describe("closeInactiveConversations() — 10-minute inactivity auto-close", () => {
  test("AI chat idle > 10 min is auto-closed with metadata + system message", async () => {
    const convo = await makeConvo("AI", 11);

    const n = await chatService.closeInactiveConversations();
    expect(n).toBe(1);

    const after = await Conversation.findById(convo._id).lean();
    expect(after.status).toBe("CLOSED");
    expect(after.closedBy).toBe("system");
    expect(after.closeReason).toBe("INACTIVITY_TIMEOUT");
    expect(after.closedAt).toBeInstanceOf(Date);

    const msgs = await sysMessages(convo._id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].message).toMatch(/automatically close|10 minutes tak koi activity/i);
  });

  test("AGENT chat idle > 10 min is also auto-closed", async () => {
    const convo = await makeConvo("AGENT", 15);
    const n = await chatService.closeInactiveConversations();
    expect(n).toBe(1);
    expect((await Conversation.findById(convo._id)).status).toBe("CLOSED");
  });

  test("chat idle only 9 min is NOT closed (timer not yet elapsed)", async () => {
    const convo = await makeConvo("WAITING_AGENT", 9);
    const n = await chatService.closeInactiveConversations();
    expect(n).toBe(0);
    expect((await Conversation.findById(convo._id)).status).toBe("WAITING_AGENT");
    expect(await sysMessages(convo._id)).toHaveLength(0);
  });

  test("a new message resets the inactivity timer", async () => {
    const convo = await makeConvo("AI", 20); // stale…
    await chatService.postMessage(convo, { senderType: "company", senderId: null, message: "hello" });
    // postMessage refreshed lastActivityAt to now → sweep must skip it.
    const n = await chatService.closeInactiveConversations();
    expect(n).toBe(0);
    expect((await Conversation.findById(convo._id)).status).toBe("AI");
  });

  test("CLOSED chat is never re-processed (no status change, no duplicate message)", async () => {
    const convo = await makeConvo("AGENT", 30);
    await chatService.closeInactiveConversations(); // first pass closes it
    const firstMsgs = await sysMessages(convo._id);
    expect(firstMsgs).toHaveLength(1);

    // Backdate again to prove a CLOSED thread is still ignored.
    await Conversation.updateOne({ _id: convo._id }, { lastActivityAt: new Date(Date.now() - 60 * 60 * 1000) });
    const n2 = await chatService.closeInactiveConversations();
    expect(n2).toBe(0);
    expect(await sysMessages(convo._id)).toHaveLength(1); // still exactly one
  });

  test("running the sweep twice back-to-back closes each thread only once", async () => {
    await makeConvo("AI", 12);
    await makeConvo("AGENT", 12);
    const first = await chatService.closeInactiveConversations();
    const second = await chatService.closeInactiveConversations();
    expect(first).toBe(2);
    expect(second).toBe(0);
  });

  test("after auto-close, starting a new chat yields a fresh ACTIVE conversation", async () => {
    const old = await makeConvo("AI", 12);
    await chatService.closeInactiveConversations();
    const fresh = await chatService.getOrCreateActiveConversation(companyId);
    expect(String(fresh._id)).not.toBe(String(old._id));
    expect(fresh.status).toBe("AI");
  });

  test("legacy conversation without lastActivityAt falls back to updatedAt", async () => {
    const convo = await makeConvo("AI", 0);
    // Simulate a pre-feature doc: strip lastActivityAt, backdate updatedAt.
    const past = new Date(Date.now() - 20 * 60 * 1000);
    await Conversation.collection.updateOne(
      { _id: convo._id },
      { $unset: { lastActivityAt: "" }, $set: { updatedAt: past } }
    );
    const n = await chatService.closeInactiveConversations();
    expect(n).toBe(1);
    expect((await Conversation.findById(convo._id)).status).toBe("CLOSED");
  });
});
