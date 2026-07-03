const supportService = require("../../services/supportService");

// Controllers only parse req, call the service, and shape the JSON response.
// Company scope comes from the token (req.user.companyId), never the client.

/** GET /api/support/tickets — the calling company's tickets, newest first. */
exports.listTickets = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const rows = await supportService.listTickets(companyId);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST /api/support/tickets — raise a new support request. */
exports.createTicket = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const ticket = await supportService.createTicket(companyId, req.body, req.user.id);
    res.status(201).json({ success: true, message: "Support request created", data: ticket });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};









