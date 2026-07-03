const express = require("express");
const router = express.Router();
const { z } = require("zod");

const { listTickets, createTicket } = require("../../controller/Support/supportController");
const authMiddleware = require("../../middlewares/authMiddlewares");
const validate = require("../../middlewares/validate");
const SupportTicket = require("../../model/Support/SupportTicket");

const createSchema = z.object({
  category: z.enum(SupportTicket.SUPPORT_CATEGORIES),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  description: z.string().trim().min(1, "Description is required").max(5000),
});

// All routes are company-scoped via the JWT (req.user.companyId).
router.get("/tickets", authMiddleware, listTickets);
router.post("/tickets", authMiddleware, validate({ body: createSchema }), createTicket);

module.exports = router;
