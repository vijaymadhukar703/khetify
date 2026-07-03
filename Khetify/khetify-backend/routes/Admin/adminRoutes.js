const express = require("express");
const router = express.Router();

const requireAdmin = require("../../middlewares/requireAdmin");
const {
  loginAdmin,
  getMe,
  getDashboard,
  listCompanies,
  getCompany,
  updateCompanyStatus,
} = require("../../controller/Admin/adminController");

// Platform admin API. Login is open (issues the admin JWT); everything else
// requires a valid super_admin token.
router.post("/login", loginAdmin);

router.get("/me", requireAdmin, getMe);
router.get("/dashboard", requireAdmin, getDashboard);
router.get("/companies", requireAdmin, listCompanies);
router.get("/companies/:id", requireAdmin, getCompany);
router.patch("/companies/:id/status", requireAdmin, updateCompanyStatus);

module.exports = router;
