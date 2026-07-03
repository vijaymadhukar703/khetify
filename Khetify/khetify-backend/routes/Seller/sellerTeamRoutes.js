const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const authorize = require("../../middlewares/authorize");
const { getTeam, createMember, updateMember, deleteMember } = require("../../controller/Seller/sellerTeamController");

// Seller team management — only roles holding user:read / user:manage (i.e.
// seller_admin) can view/manage the team; seller_manager/staff are blocked.
router.use(auth, requireApprovedSeller);
router.get("/", authorize("user:read"), getTeam);
router.post("/", authorize("user:manage"), createMember);
router.patch("/:id", authorize("user:manage"), updateMember);
router.delete("/:id", authorize("user:manage"), deleteMember);

module.exports = router;
