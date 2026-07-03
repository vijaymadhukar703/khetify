const express = require("express");

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const uploadDocuments = require("../../middlewares/uploadDocuments");
const pc = require("../../controller/Company/companyPcController");

// Company review queue + certificate management. Gated by inventory:read — the
// same capability the existing "Sellers" admin area uses (company_admin holds it).
const CAP = "inventory:read";

/* /api/company/pc-form — the company-configurable PC application form builder */
const form = express.Router();
form.use(auth, authorize(CAP));
form.get("/", pc.getForm);
form.put("/", pc.saveForm);

/* /api/company/pc-applications */
const applications = express.Router();
applications.use(auth, authorize(CAP));
applications.get("/", pc.listApplications);
applications.get("/:id", pc.getApplication);
applications.post("/:id/review", pc.review);
applications.post("/:id/request-docs", pc.requestDocs);
applications.post("/:id/reject", pc.reject);
applications.post("/:id/approve", pc.approve);
applications.post("/:id/agreement/attach", uploadDocuments.single("file"), pc.attachAgreement);
applications.post("/:id/issue-pc", pc.issuePc);

/* /api/company/certificates */
const certificates = express.Router();
certificates.use(auth, authorize(CAP));
certificates.get("/", pc.listCertificates);
certificates.get("/:id/download", pc.downloadCertificate); // signed URL, only when active
certificates.post("/:id/revoke", pc.revoke);
certificates.post("/:id/reinstate", pc.reinstate); // revoked → active (within validity)

/* /api/company/seller-documents — verify/reject docs on this company's applications */
const sellerDocuments = express.Router();
sellerDocuments.use(auth, authorize(CAP));
sellerDocuments.post("/:id/verify", pc.verifyDocument);
sellerDocuments.post("/:id/reject", pc.rejectDocument);

module.exports = { form, applications, certificates, sellerDocuments };
