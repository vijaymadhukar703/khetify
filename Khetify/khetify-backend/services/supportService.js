const SupportTicket = require("../model/Support/SupportTicket");
const { nextSeq } = require("./counterService");

// Business logic for company support tickets. Every query is scoped by
// companyId so one tenant can never read or create against another.

/**
 * Create a support ticket for a company. Allocates a per-company sequential
 * ticket number ("REQ-<n>") via the shared counter so ids are unique & ordered.
 */
async function createTicket(companyId, { category, subject, description }, raisedBy) {
  const seq = await nextSeq(companyId, "support_ticket");
  const ticket = await SupportTicket.create({
    companyId,
    ticketId: `REQ-${seq}`,
    category,
    subject,
    description,
    status: "open",
    raisedBy,
  });
  return ticket;
}

/** List a company's tickets, newest first. */
async function listTickets(companyId) {
  return SupportTicket.find({ companyId }).sort({ createdAt: -1 }).lean();
}

module.exports = { createTicket, listTickets };
