const mongoose = require("mongoose");
require("../model/Company/Company");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Seller = require("../model/Seller/Seller");
const SellerCompanyLink = require("../model/Seller/SellerCompanyLink");
const SellerDocument = require("../model/PC/SellerDocument");
const PCApplication = require("../model/PC/PCApplication");
const SellerAgreement = require("../model/PC/SellerAgreement");
const PrincipalCertificate = require("../model/PC/PrincipalCertificate");
const SellerListing = require("../model/PC/SellerListing");
const pcService = require("../services/pcService");
const requireActivePC = require("../middlewares/requireActivePC");
const sellerDocCtrl = require("../controller/Seller/sellerDocumentController");
const sellerPcCtrl = require("../controller/Seller/sellerPcController");
const companyPcCtrl = require("../controller/Company/companyPcController");
const sellerCompanyCtrl = require("../controller/Seller/sellerCompanyController");

// Keep generated PDFs out of S3 — local driver writes to uploads/ in tests.
process.env.STORAGE_DRIVER = "local";

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyA, companyB, sellerId, productId, docId;

async function mkCompany(name) {
  const c = await Company.create({ fullName: name, email: `${name.replace(/\s/g, "")}-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: name } });
  return c._id;
}

beforeEach(async () => {
  companyA = await mkCompany("Alpha Agri");
  companyB = await mkCompany("Beta Crop");
  productId = (await Product.create({ companyId: companyA, productName: "Urea", skuNumber: "UR", mrp: 270 }))._id;
  const s = await Seller.create({
    passwordHash: "x", status: "pending", linkStatus: "unlinked",
    email: "krishna@x.com", phone: "9990001111",
    sellerInfo: { businessName: "Krishna Traders", productCategories: ["fertilizer"] },
    verification: { gstin: "GST123", pan: "PAN123" },
    contact: { ownerName: "Krishna Rao", officialEmail: "krishna@x.com", officialPhone: "9990001111", address: { line: "1 St", city: "Indore", state: "MP", pincode: "452001" } },
  });
  sellerId = s._id;
  // A PC request now requires a COMPLETE PROFILE (issuing the PC IS the approval —
  // there is no separate link gate). Seed the GST + PAN KYC docs so the profile
  // is complete; the gst doc is reused as the explicit attachment below.
  docId = (await SellerDocument.create({ sellerId, docType: "gst", fileKey: `sellers/${sellerId}/gst.pdf`, fileName: "gst.pdf" }))._id;
  await SellerDocument.create({ sellerId, docType: "pan", fileKey: `sellers/${sellerId}/pan.pdf`, fileName: "pan.pdf" });
});

// Drive a full apply→issue and return the certificate.
async function fullIssue(companyId) {
  const app = await pcService.applyForPc({ sellerId, companyId, productCategories: ["fertilizer"], documentIds: [docId] });
  await pcService.reviewApp(companyId, app._id, companyId);
  await pcService.approveApp(companyId, app._id, companyId);
  await pcService.signAgreement({ sellerId, applicationId: app._id, signedName: "Krishna", ip: "1.2.3.4" });
  const { cert } = await pcService.issuePc(companyId, app._id, { validMonths: 36, issuedBy: companyId });
  return { app, cert };
}

describe("PART A — seller documents", () => {
  test("upload + list; delete allowed when not bound to an issued PC", async () => {
    const req = { user: { sellerId }, files: [{ buffer: Buffer.from("hello"), originalname: "gst.pdf", mimetype: "application/pdf" }], body: { docType: "gst", label: "GST cert" } };
    const res = mockRes();
    await sellerDocCtrl.uploadDocuments(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.data[0].fileKey).toMatch(/sellers\//);
    expect(res.body.data[0].docType).toBe("gst");

    const listRes = mockRes();
    await sellerDocCtrl.getDocuments({ user: { sellerId } }, listRes);
    expect(listRes.body.count).toBe(3); // the seeded gst + pan docs + the one just uploaded

    const delRes = mockRes();
    await sellerDocCtrl.deleteDocument({ user: { sellerId }, params: { id: res.body.data[0]._id } }, delRes);
    expect(delRes.body.success).toBe(true);
  });
});

describe("PART B–C–D — apply → review → request-docs → resubmit → approve → sign → issue", () => {
  test("full happy path reaches active with an issued certificate", async () => {
    const app = await pcService.applyForPc({ sellerId, companyId: companyA, productCategories: ["fertilizer"], documentIds: [docId] });
    expect(app.status).toBe("applied");
    expect(app.businessSnapshot.gstin).toBe("GST123"); // snapshot captured

    await pcService.reviewApp(companyA, app._id, companyA);
    expect((await PCApplication.findById(app._id)).status).toBe("under_review");

    await pcService.requestDocs(companyA, app._id, companyA, { docs: ["license"], note: "Need trade license" });
    expect((await PCApplication.findById(app._id)).status).toBe("need_more_docs");

    await pcService.attachDocs({ sellerId, applicationId: app._id, documentIds: [] });
    expect((await PCApplication.findById(app._id)).status).toBe("under_review");

    const { agreement } = await pcService.approveApp(companyA, app._id, companyA);
    expect((await PCApplication.findById(app._id)).status).toBe("agreement_pending");
    expect(agreement.unsignedPdfUrl).toBeTruthy();
    expect(agreement.status).toBe("generated");

    await pcService.signAgreement({ sellerId, applicationId: app._id, signedName: "Krishna", ip: "1.2.3.4" });
    const signed = await SellerAgreement.findOne({ applicationId: app._id });
    expect(signed.status).toBe("signed");
    expect(signed.signatureType).toBe("digital");
    expect(signed.signedPdfUrl).toBeTruthy();
    expect((await PCApplication.findById(app._id)).status).toBe("agreement_signed");

    const { cert } = await pcService.issuePc(companyA, app._id, { validMonths: 36, issuedBy: companyA });
    expect(cert.pcNumber).toMatch(/^KH-PC-[A-Z0-9]{2,3}-\d{4}-\d{4}$/);
    expect(cert.status).toBe("active");
    expect(cert.pdfUrl).toBeTruthy();
    expect((await PCApplication.findById(app._id)).status).toBe("active");

    // reconcile: older link/linkStatus now approved (PC is source of truth)
    expect((await SellerCompanyLink.findOne({ sellerId, companyId: companyA })).status).toBe("approved");
    expect((await Seller.findById(sellerId)).linkStatus).toBe("approved");
  });

  test("issuing a PC always makes it active immediately and downloadable (no govt step)", async () => {
    const { app, cert } = await fullIssue(companyA);
    expect(cert.status).toBe("active"); // active right away
    expect(cert.govt.required).toBe(false);
    expect((await PCApplication.findById(app._id)).status).toBe("active");
    expect(await pcService.hasActivePc(sellerId, companyA)).toBe(true);

    const dl = mockRes();
    await sellerPcCtrl.downloadCertificate({ user: { sellerId }, params: { id: cert._id } }, dl);
    expect(dl.body.success).toBe(true);
    expect(dl.body.data.url).toBeTruthy();
  });

  test("issue ignores any legacy govtRequired input — still active immediately", async () => {
    const app = await pcService.applyForPc({ sellerId, companyId: companyB, productCategories: ["fertilizer"], documentIds: [docId] });
    await pcService.reviewApp(companyB, app._id, companyB);
    await pcService.approveApp(companyB, app._id, companyB);
    await pcService.signAgreement({ sellerId, applicationId: app._id, signedName: "Krishna", ip: "1.2.3.4" });
    const res = mockRes();
    await companyPcCtrl.issuePc({ user: { companyId: companyB, id: companyB }, params: { id: app._id }, body: { validMonths: 24, govtRequired: true } }, res);
    expect(res.body.success).toBe(true);
    const cert = await PrincipalCertificate.findOne({ applicationId: app._id });
    expect(cert.status).toBe("active");
    expect(cert.govt.required).toBe(false);
  });

  test("only one active application per (seller, company)", async () => {
    await pcService.applyForPc({ sellerId, companyId: companyA, productCategories: [], documentIds: [docId] });
    await expect(pcService.applyForPc({ sellerId, companyId: companyA, productCategories: [], documentIds: [docId] }))
      .rejects.toMatchObject({ status: 409 });
  });

  test("PROFILE PREREQUISITE — a seller with an incomplete profile can't start a PC request (400)", async () => {
    // a bare seller: missing contact/email/phone + no KYC docs → incomplete
    const bare = (await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Bare" } }))._id;
    await expect(pcService.applyForPc({ sellerId: bare, companyId: companyA, productCategories: [] }))
      .rejects.toMatchObject({ status: 400, code: "PROFILE_INCOMPLETE" });

    // controller surfaces the same 400 with the missing list
    const res = mockRes();
    await sellerPcCtrl.createApplication({ user: { sellerId: bare }, body: { companyId: companyA } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/profile/i);
  });

  test("a complete-profile seller can apply WITHOUT any prior link; profile KYC docs auto-attach", async () => {
    // no SellerCompanyLink exists — applying is allowed (issuing the PC is the approval)
    const ok = mockRes();
    await sellerPcCtrl.createApplication({ user: { sellerId }, body: { companyId: companyA, productCategories: ["fertilizer"] } }, ok);
    expect(ok.statusCode).toBe(201);
    // the gst + pan profile docs were auto-attached even though none were passed
    const app = await PCApplication.findById(ok.body.data._id);
    expect(app.documentIds.length).toBeGreaterThanOrEqual(2);
  });

  test("the seller Companies list reflects PC issuance (active), not a separate link", async () => {
    await fullIssue(companyA); // issue a PC for companyA only
    const res = mockRes();
    await sellerCompanyCtrl.getSellerCompanyLinks({ user: { sellerId }, query: { status: "active" } }, res);
    const ids = res.body.data.map((c) => String(c._id));
    expect(ids).toContain(String(companyA));   // PC issued → shows as active
    expect(ids).not.toContain(String(companyB)); // no PC → not in the active list
  });

  test("issue-pc before the agreement is signed is rejected (out-of-order)", async () => {
    const app = await pcService.applyForPc({ sellerId, companyId: companyA, productCategories: [], documentIds: [docId] });
    await expect(pcService.issuePc(companyA, app._id, { issuedBy: companyA })).rejects.toMatchObject({ status: 409 });
  });

  test("company /review advances Applied → Under Review and rejects an invalid FROM-status", async () => {
    const app = await pcService.applyForPc({ sellerId, companyId: companyA, productCategories: [], documentIds: [docId] });
    expect(app.status).toBe("applied");

    const res = mockRes();
    await companyPcCtrl.review({ user: { companyId: companyA, id: companyA }, params: { id: app._id } }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("under_review");
    expect((await PCApplication.findById(app._id)).status).toBe("under_review");

    // reject it, then a second /review must fail (invalid FROM-status, surfaced)
    await pcService.rejectApp(companyA, app._id, companyA, { reason: "no" });
    const bad = mockRes();
    await companyPcCtrl.review({ user: { companyId: companyA, id: companyA }, params: { id: app._id } }, bad);
    expect(bad.statusCode).toBe(409);
    expect(bad.body.message).toMatch(/Cannot start review/i);
  });

  test("company can verify / reject a document on its own application", async () => {
    const docRes = mockRes();
    await sellerDocCtrl.uploadDocuments({ user: { sellerId }, files: [{ buffer: Buffer.from("x"), originalname: "g.pdf", mimetype: "application/pdf" }], body: { docType: "gst" } }, docRes);
    const docId = docRes.body.data[0]._id;
    await pcService.applyForPc({ sellerId, companyId: companyA, productCategories: [], documentIds: [docId] });

    const vRes = mockRes();
    await companyPcCtrl.verifyDocument({ user: { companyId: companyA, id: companyA }, params: { id: docId }, body: {} }, vRes);
    expect(vRes.body.data.status).toBe("verified");

    const rRes = mockRes();
    await companyPcCtrl.rejectDocument({ user: { companyId: companyA, id: companyA }, params: { id: docId }, body: { note: "illegible" } }, rRes);
    expect(rRes.body.data.status).toBe("rejected");

    // a company that the doc's application isn't addressed to can't touch it
    const denied = mockRes();
    await companyPcCtrl.verifyDocument({ user: { companyId: companyB, id: companyB }, params: { id: docId }, body: {} }, denied);
    expect(denied.statusCode).toBe(403);
  });
});

describe("agreement exchange: company attaches → seller signs → issue", () => {
  async function toAgreementPending(companyId = companyA) {
    const app = await pcService.applyForPc({ sellerId, companyId, productCategories: ["fertilizer"], documentIds: [docId] });
    await pcService.reviewApp(companyId, app._id, companyId);
    await pcService.approveApp(companyId, app._id, companyId);
    return app;
  }
  const file = (name = "agreement.pdf") => ({ buffer: Buffer.from("contract"), originalname: name, mimetype: "application/pdf" });

  test("company attach stores the file on the agreement; seller can fetch it", async () => {
    const app = await toAgreementPending();
    await pcService.attachAgreement(companyA, app._id, { file: file(), attachedBy: companyA });
    const ag = await pcService.getAgreement(app._id, sellerId);
    expect(ag.agreementFileUrl).toBeTruthy();
    expect(ag.attachedAt).toBeTruthy();
  });

  test("signing the attached agreement flips to agreement_signed with the attached file as the signed doc, then issues", async () => {
    const app = await toAgreementPending();
    await pcService.attachAgreement(companyA, app._id, { file: file(), attachedBy: companyA });
    const before = await pcService.getAgreement(app._id, sellerId);

    await pcService.signAgreement({ sellerId, applicationId: app._id, signedName: "Krishna", ip: "1.2.3.4" });
    const ag = await pcService.getAgreement(app._id, sellerId);
    expect(ag.status).toBe("signed");
    expect(ag.signatureType).toBe("digital");
    expect(ag.signedPdfUrl).toBe(before.agreementFileUrl); // company contract is the signed doc of record
    expect((await PCApplication.findById(app._id)).status).toBe("agreement_signed");

    const { cert } = await pcService.issuePc(companyA, app._id, { validMonths: 12, issuedBy: companyA });
    expect(cert.pcNumber).toBeTruthy();
    expect((await PCApplication.findById(app._id)).status).toBe("active");
  });

  test("attach is rejected when the application is not awaiting signature", async () => {
    const app = await pcService.applyForPc({ sellerId, companyId: companyB, productCategories: [], documentIds: [docId] });
    await expect(pcService.attachAgreement(companyB, app._id, { file: file(), attachedBy: companyB }))
      .rejects.toMatchObject({ status: 409 });
  });
});

describe("PART F — gating + uniqueness + multi-company", () => {
  test("listing is blocked without an active PC and allowed with one", async () => {
    const mw = requireActivePC((req) => req.body.companyId);

    // before issuing → 403
    let res = mockRes(); let nexted = false;
    await mw({ user: { sellerId }, body: { companyId: companyA } }, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("NO_ACTIVE_PC");

    await fullIssue(companyA);

    // after issuing → next() and publish works
    res = mockRes(); nexted = false;
    await mw({ user: { sellerId }, body: { companyId: companyA } }, res, () => { nexted = true; });
    expect(nexted).toBe(true);

    const pubRes = mockRes();
    await sellerPcCtrl.publishListing({ user: { sellerId }, body: { companyId: companyA, productId } }, pubRes);
    expect(pubRes.statusCode).toBe(201);
    expect(await SellerListing.countDocuments({ sellerId, companyId: companyA })).toBe(1);
  });

  test("expired and revoked certificates block listing", async () => {
    const { cert } = await fullIssue(companyA);
    expect(await pcService.hasActivePc(sellerId, companyA)).toBe(true);

    // expire it
    await PrincipalCertificate.updateOne({ _id: cert._id }, { $set: { validUntil: new Date("2000-01-01") } });
    expect(await pcService.hasActivePc(sellerId, companyA)).toBe(false);

    // restore validity then revoke
    await PrincipalCertificate.updateOne({ _id: cert._id }, { $set: { validUntil: new Date("2099-01-01") } });
    expect(await pcService.hasActivePc(sellerId, companyA)).toBe(true);
    await pcService.revokeCertificate(companyA, cert._id);
    expect(await pcService.hasActivePc(sellerId, companyA)).toBe(false);
  });

  test("a seller can hold MULTIPLE PCs across companies; PC numbers are unique", async () => {
    const a = await fullIssue(companyA);
    const b = await fullIssue(companyB);
    expect(a.cert.pcNumber).not.toBe(b.cert.pcNumber);
    expect(await pcService.hasActivePc(sellerId, companyA)).toBe(true);
    expect(await pcService.hasActivePc(sellerId, companyB)).toBe(true);
    expect(await PrincipalCertificate.countDocuments({ sellerId })).toBe(2);

    // unique index holds
    await expect(PrincipalCertificate.create({ pcNumber: a.cert.pcNumber, sellerId, companyId: companyB }))
      .rejects.toThrow();
  });
});

describe("revoke / reinstate keep certificate ↔ application in sync", () => {
  test("revoke → cert revoked + application revoked + not downloadable + listing blocked", async () => {
    const { app, cert } = await fullIssue(companyA);
    expect(await pcService.hasActivePc(sellerId, companyA)).toBe(true);

    await pcService.revokeCertificate(companyA, cert._id, { reason: "breach", revokedBy: companyA });
    const c = await PrincipalCertificate.findById(cert._id);
    expect(c.status).toBe("revoked");
    expect(c.revokedReason).toBe("breach");
    expect((await PCApplication.findById(app._id)).status).toBe("revoked"); // app out of Active
    expect(await pcService.hasActivePc(sellerId, companyA)).toBe(false); // listing blocked

    const sd = mockRes();
    await sellerPcCtrl.downloadCertificate({ user: { sellerId }, params: { id: cert._id } }, sd);
    expect(sd.statusCode).toBe(403);
    const cd = mockRes();
    await companyPcCtrl.downloadCertificate({ user: { companyId: companyA, id: companyA }, params: { id: cert._id } }, cd);
    expect(cd.statusCode).toBe(403);
  });

  test("reinstate within validity → active again + downloadable + listing allowed + app active", async () => {
    const { app, cert } = await fullIssue(companyA);
    await pcService.revokeCertificate(companyA, cert._id, { revokedBy: companyA });
    await pcService.reinstateCertificate(companyA, cert._id, { reinstatedBy: companyA });

    const c = await PrincipalCertificate.findById(cert._id);
    expect(c.status).toBe("active");
    expect(c.revokedAt).toBeFalsy();
    expect((await PCApplication.findById(app._id)).status).toBe("active");
    expect(await pcService.hasActivePc(sellerId, companyA)).toBe(true);

    const sd = mockRes();
    await sellerPcCtrl.downloadCertificate({ user: { sellerId }, params: { id: cert._id } }, sd);
    expect(sd.body.success).toBe(true);
    expect(sd.body.data.url).toBeTruthy();
  });

  test("reinstate on an expired (validity lapsed) revoked cert is refused (re-issue instead)", async () => {
    const { cert } = await fullIssue(companyA);
    await pcService.revokeCertificate(companyA, cert._id, { revokedBy: companyA });
    await PrincipalCertificate.updateOne({ _id: cert._id }, { $set: { validUntil: new Date("2000-01-01") } });
    await expect(pcService.reinstateCertificate(companyA, cert._id, { reinstatedBy: companyA }))
      .rejects.toMatchObject({ status: 409 });
  });

  test("certificate download returns a working URL only when active", async () => {
    const { cert } = await fullIssue(companyA);
    const ok = mockRes();
    await sellerPcCtrl.downloadCertificate({ user: { sellerId }, params: { id: cert._id } }, ok);
    expect(ok.body.success).toBe(true);
    expect(ok.body.data.url).toMatch(/uploads|https?:\/\//);
  });
});
