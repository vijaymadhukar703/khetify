const cron = require("node-cron");
const { classifyAllCompanies } = require("../services/abcService");
const outbox = require("../services/outboxService");
const { reconcileAllCompanies } = require("../services/reconciliationService");
const chatService = require("../services/chatService");

/**
 * Starts background jobs. Called once from Server.js after the DB connects.
 * Kept out of the request path and out of tests (tests don't import Server.js).
 */
function startJobs() {
  // Nightly ABC re-classification at 02:00 server time.
  cron.schedule("0 2 * * *", async () => {
    try {
      const r = await classifyAllCompanies();
      console.log(`🔤 ABC classification ran for ${r.companies} company(ies)`);
    } catch (err) {
      console.error("ABC job failed:", err.message);
    }
  });
  // Webhook outbox dispatcher — every minute, deliver due events with backoff.
  cron.schedule("* * * * *", async () => {
    try {
      const r = await outbox.dispatchPending({});
      if (r.processed) console.log(`📤 Outbox: ${r.delivered} delivered, ${r.failed} failed`);
    } catch (err) {
      console.error("Outbox dispatch failed:", err.message);
    }
  });

  // Support chat inactivity sweep — every minute, auto-close threads idle >10 min.
  // Backend-driven so it survives browser reload/close and server restarts.
  cron.schedule("* * * * *", async () => {
    try {
      const n = await chatService.closeInactiveConversations();
      if (n) console.log(`💤 Support chat: auto-closed ${n} inactive conversation(s)`);
    } catch (err) {
      console.error("Chat inactivity sweep failed:", err.message);
    }
  });

  // Daily ledger-vs-stock reconciliation at 03:00 — flags drift, notifies owner.
  cron.schedule("0 3 * * *", async () => {
    try {
      const r = await reconcileAllCompanies();
      console.log(`🧾 Reconciliation: ${r.flagged}/${r.companies} company(ies) flagged`);
    } catch (err) {
      console.error("Reconciliation job failed:", err.message);
    }
  });

  console.log("⏰ Background jobs scheduled");
}

module.exports = { startJobs };
