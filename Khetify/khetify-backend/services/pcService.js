const Seller = require("../model/Seller/Seller");
const Company = require("../model/Company/Company");
const SellerCompanyLink = require("../model/Seller/SellerCompanyLink");
const SellerDocument = require("../model/PC/SellerDocument");
const CompanyPcForm = require("../model/PC/CompanyPcForm");
const PCApplication = require("../model/PC/PCApplication");
const SellerAgreement = require("../model/PC/SellerAgreement");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const { nextSeq } = require("./counterService");
const fileService = require("./fileService");
const pcPdf = require("./pcPdfService");
const { notify } = require("./notificationService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const companyName = (c) => c?.companyInfo?.companyName || c?.fullName || "Company";
const sellerName = (s) => s?.sellerInfo?.businessName || s?.contact?.ownerName || "Seller";

/** 3-letter company code for the PC number (alnum, from the company name). */
function companyCode(c) {
  const base = (c?.companyInfo?.companyName || c?.fullName || "CO").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (base.slice(0, 3) || "CO").padEnd(2, "X");
}

/** Immutable snapshot of the seller's business details at application time. */
function snapshotSeller(seller) {
  return {
    businessName: seller.sellerInfo?.businessName || "",
    gstin: seller.verification?.gstin || "",
    pan: seller.verification?.pan || "",
    address: [seller.contact?.address?.line, seller.contact?.address?.city, seller.contact?.address?.state, seller.contact?.address?.pincode].filter(Boolean).join(", "),
    licenses: seller.verification?.udyam ? [seller.verification.udyam] : [],
  };
}

function pushTimeline(app, status, byType, byId, note) {
  app.timeline.push({ status, at: new Date(), byType, byId, note });
}

async function notifySeller(sellerId, title, body, payload) {
  await notify({ recipientType: "seller", recipientId: sellerId, type: "pc_status", title, body, payload }).catch(() => {});
}
async function notifyCompany(companyId, title, body, payload) {
  await notify({ recipientType: "company", recipientId: companyId, type: "pc_status", title, body, payload }).catch(() => {});
}

/* ───────── company-configurable PC application FORM + profile autofill ───────── */

/** The seller's PROFILE values, keyed by the dot-paths a form field's
 * `profileField` references. File fields resolve to a SIGNED url + carry the
 * backing SellerDocument id so the application can attach it without re-upload. */
async function sellerAutofill(seller, docs) {
  const addr = seller.contact?.address || {};
  const address = [addr.line, addr.city, addr.state, addr.pincode].filter((x) => x && String(x).trim()).join(", ");
  const byType = (t) => docs.find((d) => d.docType === t);
  const gst = byType("gst");
  const pan = byType("pan");
  const values = {
    "identity.businessName": seller.sellerInfo?.businessName || "",
    "identity.contactPerson": seller.contact?.ownerName || "",
    "identity.email": seller.contact?.officialEmail || seller.email || "",
    "identity.phone": seller.contact?.officialPhone || seller.phone || "",
    "identity.address": address,
    "compliance.gstin": seller.verification?.gstin || "",
    "compliance.pan": seller.verification?.pan || "",
    "compliance.gstCertificateUrl": gst ? await fileService.signedUrl(gst.fileKey) : "",
    "compliance.panFileUrl": pan ? await fileService.signedUrl(pan.fileKey) : "",
  };
  const docIdFor = { "compliance.gstCertificateUrl": gst?._id, "compliance.panFileUrl": pan?._id };
  return { values, docIdFor };
}

/** Profile-completeness checks — mirrors the frontend profileChecks so the gate
 * is identical on both sides. Returns { complete, missing[] }. */
async function sellerProfileCompleteness(sellerId) {
  const seller = await Seller.findById(sellerId);
  if (!seller) throw httpErr("Seller not found", 404);
  const docs = await SellerDocument.find({ sellerId }).select("docType");
  const has = (v) => !!(v && String(v).trim());
  const addr = seller.contact?.address || {};
  const address = [addr.line, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ");
  const hasDoc = (t) => docs.some((d) => d.docType === t);
  const checks = [
    { label: "Business name", ok: has(seller.sellerInfo?.businessName) },
    { label: "Contact person", ok: has(seller.contact?.ownerName) },
    { label: "Email", ok: has(seller.contact?.officialEmail || seller.email) },
    { label: "Phone", ok: has(seller.contact?.officialPhone || seller.phone) },
    { label: "Address", ok: has(address) },
    { label: "GSTIN", ok: has(seller.verification?.gstin) },
    { label: "PAN", ok: has(seller.verification?.pan) },
    { label: "GST certificate", ok: hasDoc("gst") },
    { label: "PAN file", ok: hasDoc("pan") },
  ];
  return { complete: checks.every((c) => c.ok), missing: checks.filter((c) => !c.ok).map((c) => c.label) };
}

/** A company's PC form, or the DEFAULT field set if none is saved yet. */
async function getCompanyForm(companyId) {
  const form = await CompanyPcForm.findOne({ companyId });
  if (form && form.fields?.length) return form.fields.map((f) => (f.toObject ? f.toObject() : f));
  return CompanyPcForm.DEFAULT_PC_FORM_FIELDS.map((f) => ({ ...f }));
}

/** Company admin saves/updates its PC form (validated). */
async function saveCompanyForm(companyId, fields, updatedBy) {
  if (!Array.isArray(fields) || !fields.length) throw httpErr("At least one form field is required", 400);
  const keys = new Set();
  const clean = fields.map((f, i) => {
    const key = String(f.key || "").trim();
    const label = String(f.label || "").trim();
    if (!key) throw httpErr(`Field ${i + 1} needs a key`, 400);
    if (!label) throw httpErr(`Field "${key}" needs a label`, 400);
    if (keys.has(key)) throw httpErr(`Duplicate field key "${key}"`, 400);
    keys.add(key);
    const type = CompanyPcForm.FIELD_TYPES.includes(f.type) ? f.type : "text";
    return {
      key, label, type,
      required: !!f.required,
      options: type === "select" ? (f.options || []).map((o) => String(o)).filter(Boolean) : undefined,
      profileField: f.profileField ? String(f.profileField) : null,
    };
  });
  const form = await CompanyPcForm.findOneAndUpdate(
    { companyId },
    { $set: { fields: clean, updatedBy } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return form.fields.map((f) => (f.toObject ? f.toObject() : f));
}

/** Seller-facing: load a company's form with profile autofill + the profile
 * prerequisite state. The seller fills only the non-autofilled fields. */
async function getApplyForm(sellerId, companyId) {
  const company = await Company.findOne({ _id: companyId, status: "approved" }).select("companyInfo.companyName fullName");
  if (!company) throw httpErr("Company not found", 404);
  const seller = await Seller.findById(sellerId);
  if (!seller) throw httpErr("Seller not found", 404);
  const docs = await SellerDocument.find({ sellerId });
  const [fields, profile, autofill] = await Promise.all([
    getCompanyForm(companyId),
    sellerProfileCompleteness(sellerId),
    sellerAutofill(seller, docs),
  ]);
  // Per-field prefill from the profile (read-only-from-profile in the UI).
  const prefill = {};
  for (const f of fields) {
    if (f.profileField && autofill.values[f.profileField] !== undefined) prefill[f.key] = autofill.values[f.profileField];
  }
  const existing = await PCApplication.findOne({ sellerId, companyId, status: { $in: PCApplication.ACTIVE_STATUSES } }).select("status");
  return { company: { _id: company._id, name: companyName(company) }, fields, prefill, profile, alreadyApplied: !!existing };
}

/* ───────────────────────── PART B — apply + review ───────────────────────── */

async function applyForPc({ sellerId, companyId, productCategories = [], documentIds = [], formAnswers = {} }) {
  const seller = await Seller.findById(sellerId);
  if (!seller) throw httpErr("Seller not found", 404);
  const company = await Company.findOne({ _id: companyId, status: "approved" }).select("companyInfo.companyName fullName");
  if (!company) throw httpErr("Company not found", 404);

  // PROFILE PREREQUISITE — a PC request can only START once the seller's profile
  // is complete (replaces the old approved-link gate; issuing a PC IS the approval).
  const profile = await sellerProfileCompleteness(sellerId);
  if (!profile.complete) {
    const err = httpErr(`Complete your profile first — missing: ${profile.missing.join(", ")}`, 400);
    err.code = "PROFILE_INCOMPLETE";
    err.data = { missing: profile.missing };
    throw err;
  }

  // One active application per (seller, company); a current active PC also blocks.
  const existing = await PCApplication.findOne({ sellerId, companyId, status: { $in: PCApplication.ACTIVE_STATUSES } });
  if (existing) throw httpErr("You already have an active application or certificate with this company", 409);

  // Auto-attach the profile's KYC docs (gst/pan) plus any explicitly chosen docs.
  const docs = await SellerDocument.find({ sellerId });
  const { docIdFor } = await sellerAutofill(seller, docs);
  const autoDocIds = Object.values(docIdFor).filter(Boolean).map(String);
  const chosen = await SellerDocument.find({ _id: { $in: documentIds }, sellerId }).select("_id");
  const allDocIds = [...new Set([...autoDocIds, ...chosen.map((d) => String(d._id))])];
  if (!allDocIds.length) throw httpErr("Attach at least one business document to submit your application", 400);

  const fields = await getCompanyForm(companyId);
  const cats = productCategories?.length ? productCategories
    : String(formAnswers.productCategories || "").split(",").map((s) => s.trim()).filter(Boolean);

  const app = await PCApplication.create({
    sellerId, companyId,
    status: "applied",
    productCategories: cats,
    businessSnapshot: snapshotSeller(seller),
    documentIds: allDocIds,
    formAnswers: formAnswers || {},
    formSnapshot: fields,
    timeline: [{ status: "applied", at: new Date(), byType: "seller", byId: sellerId }],
  });
  await notifyCompany(companyId, "New PC application", `${sellerName(seller)} applied to become an authorized reseller.`, { applicationId: app._id, kind: "pc_applied" });
  return app;
}

async function attachDocs({ sellerId, applicationId, documentIds = [] }) {
  const app = await PCApplication.findOne({ _id: applicationId, sellerId });
  if (!app) throw httpErr("Application not found", 404);
  const docs = await SellerDocument.find({ _id: { $in: documentIds }, sellerId }).select("_id");
  const ids = new Set(app.documentIds.map(String));
  docs.forEach((d) => ids.add(String(d._id)));
  app.documentIds = [...ids];
  if (["need_more_docs", "applied"].includes(app.status)) app.status = "under_review";
  pushTimeline(app, "under_review", "seller", sellerId, "Documents submitted");
  await app.save();
  await notifyCompany(app.companyId, "Seller submitted documents", "Requested documents were added — ready for review.", { applicationId: app._id, kind: "pc_docs_added" });
  return app;
}

/** Company-side transition guarded to the reviewing company. */
async function loadCompanyApp(companyId, applicationId) {
  const app = await PCApplication.findOne({ _id: applicationId, companyId });
  if (!app) throw httpErr("Application not found", 404);
  return app;
}

// Decisions are only valid from the pre-approval states.
const REVIEWABLE = ["applied", "under_review", "need_more_docs"];
function assertFrom(app, allowed, action) {
  if (!allowed.includes(app.status)) throw httpErr(`Cannot ${action} an application that is ${app.status.replace(/_/g, " ")}`, 409);
}

async function reviewApp(companyId, applicationId, reviewerId) {
  const app = await loadCompanyApp(companyId, applicationId);
  assertFrom(app, REVIEWABLE, "start review on");
  app.status = "under_review";
  app.reviewedBy = reviewerId; app.reviewedAt = new Date();
  pushTimeline(app, "under_review", "company", reviewerId);
  await app.save();
  return app;
}

async function requestDocs(companyId, applicationId, reviewerId, { docs = [], note }) {
  const app = await loadCompanyApp(companyId, applicationId);
  assertFrom(app, ["applied", "under_review"], "request documents on");
  app.status = "need_more_docs";
  app.requestedDocs = docs;
  app.decisionNote = note;
  pushTimeline(app, "need_more_docs", "company", reviewerId, note);
  await app.save();
  await notifySeller(app.sellerId, "More documents needed", note || `Please provide: ${docs.join(", ")}`, { applicationId: app._id, kind: "pc_need_docs" });
  return app;
}

async function rejectApp(companyId, applicationId, reviewerId, { reason }) {
  const app = await loadCompanyApp(companyId, applicationId);
  assertFrom(app, REVIEWABLE, "reject");
  app.status = "rejected";
  app.rejectionReason = reason;
  app.reviewedBy = reviewerId; app.reviewedAt = new Date();
  pushTimeline(app, "rejected", "company", reviewerId, reason);
  await app.save();
  await notifySeller(app.sellerId, "PC application rejected", reason || "Your application was rejected.", { applicationId: app._id, kind: "pc_rejected" });
  return app;
}

async function approveApp(companyId, applicationId, reviewerId) {
  const app = await loadCompanyApp(companyId, applicationId);
  assertFrom(app, REVIEWABLE, "approve");
  app.status = "approved";
  app.reviewedBy = reviewerId; app.reviewedAt = new Date();
  pushTimeline(app, "approved", "company", reviewerId);
  await app.save();
  // PART C — generate the agreement immediately and move to agreement_pending.
  const agreement = await generateAgreement(app);
  app.status = "agreement_pending";
  pushTimeline(app, "agreement_pending", "system", null, "Agreement generated");
  await app.save();
  await notifySeller(app.sellerId, "PC application approved", "Review and sign your authorization agreement to proceed.", { applicationId: app._id, agreementId: agreement._id, kind: "pc_approved" });
  return { app, agreement };
}

/* ───────────────────────── PART C — agreement ───────────────────────── */

const TERMS = (company) =>
  `This agreement authorizes the reseller to market and sell the products supplied by ${company} within the ` +
  `categories listed above. The reseller shall represent the products truthfully, comply with all applicable laws and ` +
  `the principal's pricing and quality guidelines, and shall not sub-license this authorization. The principal may ` +
  `revoke this authorization for breach. This authorization is valid only while the accompanying Principal Certificate ` +
  `remains active and the reseller's account is in good standing.`;

async function generateAgreement(app) {
  const [seller, company] = await Promise.all([
    Seller.findById(app.sellerId),
    Company.findById(app.companyId).select("companyInfo.companyName fullName"),
  ]);
  const termsText = TERMS(companyName(company));
  const pdf = await pcPdf.agreementPdf({
    company: companyName(company),
    sellerName: app.businessSnapshot?.businessName || sellerName(seller),
    gstin: app.businessSnapshot?.gstin,
    pan: app.businessSnapshot?.pan,
    address: app.businessSnapshot?.address,
    productCategories: app.productCategories,
    termsText,
  });
  const key = `sellers/${app.sellerId}/agreements/${app._id}-unsigned.pdf`;
  const { url } = await fileService.uploadBuffer(pdf, key, "application/pdf");
  return SellerAgreement.create({
    applicationId: app._id, sellerId: app.sellerId, companyId: app.companyId,
    termsText, unsignedPdfKey: key, unsignedPdfUrl: url, status: "generated",
  });
}

async function getAgreement(applicationId, sellerId) {
  return SellerAgreement.findOne({ applicationId, sellerId });
}

/** Company attaches its own agreement PDF (the contract the seller signs). */
async function attachAgreement(companyId, applicationId, { file, attachedBy }) {
  const app = await loadCompanyApp(companyId, applicationId);
  if (app.status !== "agreement_pending") throw httpErr(`Can only attach an agreement while awaiting signature (status ${app.status})`, 409);
  if (!file) throw httpErr("An agreement file is required", 400);
  const agreement = await SellerAgreement.findOne({ applicationId: app._id });
  if (!agreement) throw httpErr("Agreement not found", 404);

  const ext = (file.originalname || "").match(/\.[a-z0-9]+$/i)?.[0] || ".pdf";
  const key = `sellers/${app.sellerId}/agreements/${app._id}-company${ext}`;
  const { url } = await fileService.uploadBuffer(file.buffer, key, file.mimetype || "application/pdf");
  agreement.agreementFileKey = key;
  agreement.agreementFileUrl = url;
  agreement.attachedAt = new Date();
  agreement.attachedBy = attachedBy;
  await agreement.save();

  pushTimeline(app, "agreement_pending", "company", attachedBy, "Agreement sent for signature");
  await app.save();
  await notifySeller(app.sellerId, "Agreement ready to sign", "Your agreement is ready to review & sign.", { applicationId: app._id, kind: "pc_agreement_sent" });
  return agreement;
}

async function signAgreement({ sellerId, applicationId, signedName, ip, file }) {
  const app = await PCApplication.findOne({ _id: applicationId, sellerId });
  if (!app) throw httpErr("Application not found", 404);
  if (app.status !== "agreement_pending") throw httpErr(`Agreement can't be signed from status ${app.status}`, 409);
  const agreement = await SellerAgreement.findOne({ applicationId, sellerId });
  if (!agreement) throw httpErr("Agreement not found", 404);

  if (file) {
    // Uploaded scanned copy.
    const key = `sellers/${sellerId}/agreements/${app._id}-signed${(file.originalname || "").match(/\.[a-z0-9]+$/i)?.[0] || ".pdf"}`;
    const { url } = await fileService.uploadBuffer(file.buffer, key, file.mimetype || "application/pdf");
    agreement.signatureType = "uploaded";
    agreement.signedPdfKey = key; agreement.signedPdfUrl = url;
  } else {
    if (!signedName) throw httpErr("signedName and consent are required", 400);
    agreement.signatureType = "digital";
    agreement.signedName = signedName;
    agreement.ip = ip;
    if (agreement.agreementFileUrl) {
      // The company attached its own contract — that file is the signed document
      // of record; we record the digital signature metadata against it.
      agreement.signedPdfKey = agreement.agreementFileKey;
      agreement.signedPdfUrl = agreement.agreementFileUrl;
    } else {
      // No attached file — stamp the auto-generated draft with the signature.
      const company = await Company.findById(app.companyId).select("companyInfo.companyName fullName");
      const signed = { signedName, signedAt: new Date(), ip };
      const pdf = await pcPdf.agreementPdf({
        company: companyName(company),
        sellerName: app.businessSnapshot?.businessName,
        gstin: app.businessSnapshot?.gstin, pan: app.businessSnapshot?.pan, address: app.businessSnapshot?.address,
        productCategories: app.productCategories, termsText: agreement.termsText, signed,
      });
      const key = `sellers/${sellerId}/agreements/${app._id}-signed.pdf`;
      const { url } = await fileService.uploadBuffer(pdf, key, "application/pdf");
      agreement.signedPdfKey = key; agreement.signedPdfUrl = url;
    }
  }
  agreement.signedName = agreement.signedName || signedName;
  agreement.signedAt = new Date();
  agreement.status = "signed";
  await agreement.save();

  app.status = "agreement_signed";
  pushTimeline(app, "agreement_signed", "seller", sellerId, agreement.signatureType);
  await app.save();
  await notifyCompany(app.companyId, "Agreement signed", "The seller signed the authorization agreement — ready to issue the certificate.", { applicationId: app._id, kind: "pc_agreement_signed" });
  return { app, agreement };
}

/* ───────────────────────── PART D — issue + validity ───────────────────────── */

async function issuePc(companyId, applicationId, { validMonths = 36, issuedBy } = {}) {
  const app = await loadCompanyApp(companyId, applicationId);
  if (app.status !== "agreement_signed") throw httpErr(`PC can be issued only after the agreement is signed (status ${app.status})`, 409);
  const agreement = await SellerAgreement.findOne({ applicationId: app._id, status: "signed" });
  if (!agreement) throw httpErr("Signed agreement not found", 409);

  const [seller, company] = await Promise.all([
    Seller.findById(app.sellerId),
    Company.findById(companyId).select("companyInfo.companyName fullName"),
  ]);

  const seq = await nextSeq(companyId, "principal-certificate");
  const year = new Date().getFullYear();
  const pcNumber = `KH-PC-${companyCode(company)}-${year}-${String(seq).padStart(4, "0")}`;

  const validFrom = new Date();
  const validUntil = new Date(validFrom.getTime());
  validUntil.setMonth(validUntil.getMonth() + Number(validMonths || 36));

  const pdf = await pcPdf.certificatePdf({
    pcNumber, company: companyName(company),
    sellerName: app.businessSnapshot?.businessName || sellerName(seller),
    productCategories: app.productCategories,
    validFrom, validUntil, issuedAt: new Date(),
  });
  const key = `sellers/${app.sellerId}/certificates/${pcNumber}.pdf`;
  const { url } = await fileService.uploadBuffer(pdf, key, "application/pdf");

  // Issuing a PC ALWAYS makes it active immediately (no government-approval step).
  const cert = await PrincipalCertificate.create({
    pcNumber, sellerId: app.sellerId, companyId, applicationId: app._id, agreementId: agreement._id,
    authorization: { productCategories: app.productCategories },
    validFrom, validUntil,
    status: "active",
    pdfKey: key, pdfUrl: url,
    govt: { required: false, status: "not_required" },
    issuedBy, issuedAt: new Date(),
  });

  app.status = "pc_issued";
  pushTimeline(app, "pc_issued", "company", issuedBy, pcNumber);
  app.status = "active";
  pushTimeline(app, "active", "system", null);
  await app.save();

  await reconcileLink(app.sellerId, companyId);

  await notifySeller(app.sellerId, "Principal Certificate issued", `Your certificate ${pcNumber} is active.`, { applicationId: app._id, certificateId: cert._id, pcNumber, kind: "pc_issued" });
  return { app, cert };
}

/** Reconcile SellerCompanyLink + Seller.linkStatus so older flows keep working. */
async function reconcileLink(sellerId, companyId) {
  await SellerCompanyLink.findOneAndUpdate(
    { sellerId, companyId },
    { $set: { status: "approved", decidedAt: new Date() } },
    { upsert: true, setDefaultsOnInsert: true }
  );
  const seller = await Seller.findById(sellerId);
  if (seller && seller.linkStatus !== "approved") {
    seller.linkStatus = "approved";
    seller.status = "active";
    if (!seller.supplyingCompanyId) seller.supplyingCompanyId = companyId;
    await seller.save();
  }
}

/** Refresh a cert's computed status (expired) on read. */
function withComputedStatus(cert) {
  if (cert && cert.status === "active" && cert.validUntil && new Date(cert.validUntil) < new Date()) {
    return { ...cert.toObject(), status: "expired" };
  }
  return cert?.toObject ? cert.toObject() : cert;
}

/* ---- read-time URL resolution (resolve from stored KEYS, per storage driver) ---- */

/** Resolve an agreement's file URLs from its keys (S3 presigned / local served). */
async function resolveAgreementUrls(ag) {
  if (!ag) return ag;
  const o = ag.toObject ? ag.toObject() : ag;
  if (o.unsignedPdfKey) o.unsignedPdfUrl = await fileService.signedUrl(o.unsignedPdfKey);
  if (o.agreementFileKey) o.agreementFileUrl = await fileService.signedUrl(o.agreementFileKey);
  if (o.signedPdfKey) o.signedPdfUrl = await fileService.signedUrl(o.signedPdfKey);
  return o;
}

/** Resolve a certificate's PDF + govt proof URLs from their keys. */
async function resolveCertUrls(cert) {
  if (!cert) return cert;
  const o = cert.toObject ? cert.toObject() : cert;
  if (o.pdfKey) o.pdfUrl = await fileService.signedUrl(o.pdfKey);
  if (o.govt && o.govt.proofFileKey) o.govt.proofFileUrl = await fileService.signedUrl(o.govt.proofFileKey);
  return o;
}

async function revokeCertificate(companyId, certId, { reason, revokedBy } = {}) {
  const cert = await PrincipalCertificate.findOne({ _id: certId, companyId });
  if (!cert) throw httpErr("Certificate not found", 404);
  if (cert.status === "revoked") throw httpErr("Certificate is already revoked", 409);
  cert.status = "revoked";
  cert.revokedAt = new Date();
  cert.revokedReason = reason;
  await cert.save();
  // Keep the application in sync — out of Active to a terminal "revoked" state.
  await PCApplication.updateOne(
    { _id: cert.applicationId },
    { $set: { status: "revoked" }, $push: { timeline: { status: "revoked", at: new Date(), byType: "company", byId: revokedBy, note: reason } } }
  );
  await notifySeller(cert.sellerId, "Certificate revoked", reason ? `Certificate ${cert.pcNumber} was revoked: ${reason}` : `Certificate ${cert.pcNumber} has been revoked.`, { certificateId: cert._id, kind: "pc_revoked" });
  return cert;
  // Note: listing authorization is gated by hasActivePc() (cert.status), so a
  // revoked cert can no longer authorize listing without touching the separate
  // supply-relationship SellerCompanyLink.
}

/**
 * Reinstate a revoked certificate (within its validity) back to Active. If the
 * validity has already lapsed, reinstating is refused — re-issue instead.
 */
async function reinstateCertificate(companyId, certId, { reinstatedBy } = {}) {
  const cert = await PrincipalCertificate.findOne({ _id: certId, companyId });
  if (!cert) throw httpErr("Certificate not found", 404);
  if (cert.status !== "revoked") throw httpErr(`Only a revoked certificate can be reinstated (status ${cert.status})`, 409);
  if (cert.validUntil && new Date(cert.validUntil) < new Date()) {
    throw httpErr("This certificate's validity has lapsed — re-issue a new certificate instead of reinstating.", 409);
  }

  cert.status = "active";
  cert.revokedAt = undefined;
  cert.revokedReason = undefined;
  await cert.save();
  await PCApplication.updateOne(
    { _id: cert.applicationId },
    { $set: { status: "active" }, $push: { timeline: { status: "active", at: new Date(), byType: "company", byId: reinstatedBy, note: "Reinstated" } } }
  );
  await reconcileLink(cert.sellerId, cert.companyId); // re-authorize the seller
  await notifySeller(cert.sellerId, "Certificate reinstated", `Your certificate ${cert.pcNumber} has been reinstated — active again.`, { certificateId: cert._id, kind: "pc_reinstated" });
  return cert;
}

/* ───────────────────────── PART F — gating helper ───────────────────────── */

/** True iff the seller holds a current (active, non-expired, non-revoked) PC for the company. */
async function hasActivePc(sellerId, companyId) {
  const cert = await PrincipalCertificate.findOne({ sellerId, companyId, status: "active" });
  return !!(cert && cert.isCurrentlyActive());
}

/** Company ids where the seller holds a current active PC — the authoritative
 * "which companies can this seller sell" list (replaces approved-link lookups). */
async function companiesWithActivePc(sellerId) {
  const certs = await PrincipalCertificate.find({ sellerId, status: "active" });
  return certs.filter((c) => c.isCurrentlyActive()).map((c) => c.companyId);
}

module.exports = {
  applyForPc, attachDocs,
  reviewApp, requestDocs, rejectApp, approveApp,
  generateAgreement, getAgreement, attachAgreement, signAgreement,
  issuePc, revokeCertificate, reinstateCertificate, withComputedStatus, resolveAgreementUrls, resolveCertUrls, reconcileLink,
  getCompanyForm, saveCompanyForm, getApplyForm, sellerProfileCompleteness, sellerAutofill,
  hasActivePc, companiesWithActivePc,
  _internal: { companyCode, snapshotSeller },
};
