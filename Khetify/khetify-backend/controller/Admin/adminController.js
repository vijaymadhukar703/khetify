const Admin = require("../../model/Admin/Admin");
const Company = require("../../model/Company/Company");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fileService = require("../../services/fileService");

const VALID_STATUS = ["pending", "approved", "rejected"];

/**
 * Pick the first non-empty value across a list of candidate paths on an object.
 * Registration historically wrote KYC files under a couple of different keys
 * across app versions, so we probe the known aliases (dot-paths supported) and
 * return whatever was actually saved. Returns "" when none are present.
 */
const firstVal = (obj, paths) => {
  for (const p of paths) {
    const v = p.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
};

/* ================= AUTH ================= */

/** POST /api/admin/login  { email, password } → { token, admin } */
exports.loginAdmin = async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const admin = await Admin.findOne({ email });
    if (!admin || admin.status !== "active") {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: admin._id, role: "super_admin", principalType: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    admin.lastLoginAt = new Date();
    await admin.save({ validateModifiedOnly: true });

    res.json({
      success: true,
      message: "Login successful",
      token,
      admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/** GET /api/admin/me — the logged-in admin (drives the profile dropdown). */
exports.getMe = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select("name email role");
    if (!admin) return res.status(404).json({ success: false, message: "Admin not found" });
    res.json({ success: true, data: { id: admin._id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/* ================= DASHBOARD ================= */

/**
 * GET /api/admin/dashboard — live company counts by status. Counts come straight
 * from the DB (no hardcoding); a single aggregation keeps it one round-trip.
 */
exports.getDashboard = async (req, res) => {
  try {
    const rows = await Company.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    const by = rows.reduce((acc, r) => ({ ...acc, [r._id || "pending"]: r.count }), {});
    const pendingCompanies = by.pending || 0;
    const approvedCompanies = by.approved || 0;
    const rejectedCompanies = by.rejected || 0;

    res.json({
      success: true,
      data: {
        totalCompanies: pendingCompanies + approvedCompanies + rejectedCompanies,
        pendingCompanies,
        approvedCompanies,
        rejectedCompanies,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/* ================= COMPANIES ================= */

/** Shape a company doc into the compact row the list needs. */
const toListRow = (c) => ({
  _id: c._id,
  name: c.companyInfo?.companyName || c.fullName || "—",
  email: c.email || c.businessContact?.businessEmail || "",
  phone: c.number || c.businessContact?.businessNumber || "",
  businessType: c.companyInfo?.businessType || "",
  status: c.status || "pending",
  submittedAt: c.createdAt,
});

/**
 * GET /api/admin/companies?status=all|pending|approved|rejected&search=...
 * Search matches company name, full name, email, business email, GSTIN or PAN
 * (case-insensitive). Newest first.
 */
exports.listCompanies = async (req, res) => {
  try {
    const status = String(req.query.status || "all").toLowerCase();
    const search = String(req.query.search || "").trim();

    const filter = {};
    if (VALID_STATUS.includes(status)) filter.status = status;

    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { "companyInfo.companyName": rx },
        { fullName: rx },
        { email: rx },
        { "businessContact.businessEmail": rx },
        { "companyDocument.gstinNumber": rx },
        { "companyDocument.panNumber": rx },
      ];
    }

    const companies = await Company.find(filter)
      .select("fullName email number status companyInfo.companyName companyInfo.businessType businessContact.businessEmail businessContact.businessNumber createdAt")
      .sort({ createdAt: -1 });

    res.json({ success: true, count: companies.length, data: companies.map(toListRow) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/admin/companies/:id — full detail for the review page. Document keys
 * are resolved to reachable URLs (signed S3 / served /uploads) at read-time.
 */
exports.getCompany = async (req, res) => {
  try {
    const c = await Company.findById(req.params.id).select("-password -token -resetPasswordToken -resetPasswordExpires");
    if (!c) return res.status(404).json({ success: false, message: "Company not found" });

    const info = c.companyInfo || {};
    const contact = c.businessContact || {};
    const docu = c.companyDocument || {};
    const co = c.toObject ? c.toObject() : c;

    // Resolve each KYC file from the canonical field, falling back to the legacy
    // aliases different registration versions may have used. publicFileUrl then
    // turns the stored key/path into a reachable URL (signed S3 / served
    // /uploads), so image AND pdf both open. "" when nothing was uploaded.
    const gstKey = firstVal(co, [
      "companyDocument.gstCertificate", "companyDocument.gst_certificate",
      "companyDocument.gstDocument", "companyDocument.gstFile",
      "documents.gst", "documents.gstCertificate",
    ]);
    const panKey = firstVal(co, [
      "companyDocument.panFile", "companyDocument.panCard", "companyDocument.pan_file",
      "companyDocument.panDocument", "companyDocument.pan_document",
      "documents.pan", "documents.panFile",
    ]);
    const udyamKey = firstVal(co, [
      "companyDocument.udyamIncorporationCertificate", "companyDocument.udyamDocument",
      "companyDocument.incorporationDocument", "companyDocument.registrationCertificate",
      "documents.udyam", "documents.incorporation",
    ]);

    const [gstCertificateUrl, panFileUrl, udyamCertificateUrl] = await Promise.all([
      fileService.publicFileUrl(gstKey),
      fileService.publicFileUrl(panKey),
      fileService.publicFileUrl(udyamKey),
    ]);

    res.json({
      success: true,
      data: {
        _id: c._id,
        status: c.status || "pending",
        submittedAt: c.createdAt,
        // Basic information
        fullName: c.fullName || "",
        email: c.email || "",
        subscription: c.subscription || "free",
        // Company profile
        companyName: info.companyName || "",
        businessType: info.businessType || "",
        // Business contact
        authorizedPerson: contact.authorizedPerson || "",
        businessEmail: contact.businessEmail || "",
        address: contact.address || info.location || "",
        // Verification & KYC
        gstin: docu.gstinNumber || "",
        pan: docu.panNumber || "",
        // Uploaded documents (url null when not uploaded)
        documents: {
          gstCertificate: { number: docu.gstinNumber || "", url: gstCertificateUrl },
          pan: { number: docu.panNumber || "", url: panFileUrl },
          udyam: { number: docu.udyamIncorporationNumber || "", url: udyamCertificateUrl },
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * PATCH /api/admin/companies/:id/status  { status: "approved" | "rejected" }
 * Validates the target status. Only pending companies can be actioned, so a
 * duplicate approve/reject is rejected with 409.
 */
exports.updateCompanyStatus = async (req, res) => {
  try {
    const status = String(req.body.status || "").toLowerCase();
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be 'approved' or 'rejected'" });
    }

    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ success: false, message: "Company not found" });

    if (company.status === status) {
      return res.status(409).json({ success: false, message: `Company is already ${status}` });
    }
    if (company.status !== "pending") {
      return res.status(409).json({ success: false, message: `Company is already ${company.status}` });
    }

    company.status = status;
    await company.save({ validateModifiedOnly: true });

    res.json({ success: true, message: `Company ${status}`, data: { _id: company._id, status: company.status } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};
