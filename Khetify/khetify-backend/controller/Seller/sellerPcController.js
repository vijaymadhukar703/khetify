const PCApplication = require("../../model/PC/PCApplication");
const SellerAgreement = require("../../model/PC/SellerAgreement");
const PrincipalCertificate = require("../../model/PC/PrincipalCertificate");
const SellerListing = require("../../model/PC/SellerListing");
const pcService = require("../../services/pcService");
const fileService = require("../../services/fileService");

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
const COMPANY_SELECT = "companyInfo.companyName fullName";

/* ---- application form (company-defined, profile-autofilled) ---- */
exports.getApplyForm = async (req, res) => {
  try {
    const data = await pcService.getApplyForm(req.user.sellerId, req.params.companyId);
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};

/* ---- applications ---- */
exports.createApplication = async (req, res) => {
  try {
    const { companyId, productCategories, documentIds, formAnswers } = req.body;
    if (!companyId) return res.status(400).json({ success: false, message: "companyId is required" });
    const app = await pcService.applyForPc({
      sellerId: req.user.sellerId, companyId,
      productCategories: productCategories || [],
      documentIds: documentIds || [],
      formAnswers: formAnswers || {},
    });
    res.status(201).json({ success: true, message: "Application submitted", data: app });
  } catch (err) { fail(res, err); }
};

exports.listApplications = async (req, res) => {
  try {
    const rows = await PCApplication.find({ sellerId: req.user.sellerId })
      .sort({ createdAt: -1 })
      .populate({ path: "companyId", select: COMPANY_SELECT });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.getApplication = async (req, res) => {
  try {
    const app = await PCApplication.findOne({ _id: req.params.id, sellerId: req.user.sellerId })
      .populate({ path: "companyId", select: COMPANY_SELECT })
      .populate({ path: "documentIds" });
    if (!app) return res.status(404).json({ success: false, message: "Application not found" });
    const agreement = await pcService.resolveAgreementUrls(await SellerAgreement.findOne({ applicationId: app._id }));
    const cert = await PrincipalCertificate.findOne({ applicationId: app._id });
    const certificate = cert ? await pcService.resolveCertUrls(pcService.withComputedStatus(cert)) : null;
    res.json({ success: true, data: { application: app, agreement, certificate } });
  } catch (err) { fail(res, err); }
};

exports.attachDocuments = async (req, res) => {
  try {
    const app = await pcService.attachDocs({ sellerId: req.user.sellerId, applicationId: req.params.id, documentIds: req.body.documentIds || [] });
    res.json({ success: true, message: "Documents submitted", data: app });
  } catch (err) { fail(res, err); }
};

/* ---- agreement ---- */
exports.getAgreement = async (req, res) => {
  try {
    const agreement = await pcService.getAgreement(req.params.id, req.user.sellerId);
    if (!agreement) return res.status(404).json({ success: false, message: "Agreement not found" });
    res.json({ success: true, data: await pcService.resolveAgreementUrls(agreement) });
  } catch (err) { fail(res, err); }
};

exports.signAgreement = async (req, res) => {
  try {
    // Signing is by UPLOADING a signed copy of the agreement (no digital sign).
    if (!req.file) return res.status(400).json({ success: false, message: "Upload the signed agreement copy to submit" });
    const { app, agreement } = await pcService.signAgreement({
      sellerId: req.user.sellerId,
      applicationId: req.params.id,
      ip: req.ip,
      file: req.file,
    });
    res.json({ success: true, message: "Signed agreement uploaded", data: { status: app.status, agreement } });
  } catch (err) { fail(res, err); }
};

/* ---- certificates ---- */
exports.listCertificates = async (req, res) => {
  try {
    const rows = await PrincipalCertificate.find({ sellerId: req.user.sellerId })
      .sort({ createdAt: -1 })
      .populate({ path: "companyId", select: COMPANY_SELECT });
    const data = await Promise.all(rows.map((c) => pcService.resolveCertUrls(pcService.withComputedStatus(c))));
    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};

exports.getCertificate = async (req, res) => {
  try {
    const cert = await PrincipalCertificate.findOne({ _id: req.params.id, sellerId: req.user.sellerId }).populate({ path: "companyId", select: COMPANY_SELECT });
    if (!cert) return res.status(404).json({ success: false, message: "Certificate not found" });
    const agreement = await pcService.resolveAgreementUrls(await SellerAgreement.findOne({ _id: cert.agreementId }));
    const certificate = await pcService.resolveCertUrls(pcService.withComputedStatus(cert));
    res.json({ success: true, data: { certificate, agreementUrl: agreement?.signedPdfUrl || agreement?.unsignedPdfUrl || null } });
  } catch (err) { fail(res, err); }
};

exports.downloadCertificate = async (req, res) => {
  try {
    const cert = await PrincipalCertificate.findOne({ _id: req.params.id, sellerId: req.user.sellerId });
    if (!cert) return res.status(404).json({ success: false, message: "Certificate not found" });
    // The official certificate is downloadable only while ACTIVE (not revoked/expired).
    if (cert.status !== "active") {
      return res.status(403).json({ success: false, message: "This certificate is not active." });
    }
    res.json({ success: true, data: { pcNumber: cert.pcNumber, url: await fileService.signedUrl(cert.pdfKey) } });
  } catch (err) { fail(res, err); }
};

/* ---- marketplace listings (gated by requireActivePC) ---- */
exports.publishListing = async (req, res) => {
  try {
    const { companyId, productId, price } = req.body;
    if (!productId) return res.status(400).json({ success: false, message: "productId is required" });
    const listing = await SellerListing.findOneAndUpdate(
      { sellerId: req.user.sellerId, companyId, productId },
      { $set: { status: "published", price, publishedAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ success: true, message: "Product listed", data: listing });
  } catch (err) { fail(res, err); }
};

/* Remove a listing from the marketplace. Scoped to the seller's own listings.
   Not PC-gated — a seller can always pull their product even if the PC lapsed. */
exports.unpublishListing = async (req, res) => {
  try {
    const listing = await SellerListing.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.user.sellerId },
      { $set: { status: "unpublished" } },
      { new: true }
    );
    if (!listing) return res.status(404).json({ success: false, message: "Listing not found" });
    res.json({ success: true, message: "Product unpublished", data: listing });
  } catch (err) { fail(res, err); }
};

exports.listListings = async (req, res) => {
  try {
    const rows = await SellerListing.find({ sellerId: req.user.sellerId }).sort({ createdAt: -1 }).populate({ path: "productId", select: "productName skuNumber" });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};
