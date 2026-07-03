const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Seller = require("../model/Seller/Seller");
const SellerDocument = require("../model/PC/SellerDocument");
const companyCtrl = require("../controller/Company/companyController");
const sellerAuth = require("../controller/Seller/sellerAuthController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

describe("GET /company/profile — registration details + signed KYC docs", () => {
  let companyId;
  beforeEach(async () => {
    companyId = (await Company.create({
      fullName: "Anita Rao", email: "owner@acme.com", number: "9811111111", password: "x",
      companyInfo: { companyName: "Acme Agro", location: "Indore" },
      businessContact: { authorizedPerson: "Anita Rao", businessEmail: "contact@acme.com", businessNumber: "9822222222", address: "MG Road, Indore" },
      companyDocument: { gstinNumber: "23ABCDE1234F1Z5", panNumber: "ABCDE1234F", gstCertificate: "uploads/products/gst-1.pdf", panFile: "uploads/products/pan-1.jpg" },
    }))._id;
  });

  test("resolves the company from the TOKEN (not a client id) and signs the docs", async () => {
    const res = mockRes();
    // legacy token shape: companyId falls back to id — both present here
    await companyCtrl.getCompanyProfile({ user: { id: companyId, companyId, role: "company_admin" } }, res);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.identity.businessName).toBe("Acme Agro");
    expect(d.identity.contactPerson).toBe("Anita Rao");
    expect(d.identity.email).toBe("contact@acme.com");
    expect(d.identity.address).toBe("MG Road, Indore");
    expect(d.compliance.gstin).toBe("23ABCDE1234F1Z5");
    expect(d.compliance.pan).toBe("ABCDE1234F");
    // served URLs (local driver) — never a hardcoded localhost path
    expect(d.compliance.gstCertificateUrl).toBe("/uploads/products/gst-1.pdf");
    expect(d.compliance.panFileUrl).toBe("/uploads/products/pan-1.jpg");
    expect(d.compliance.gstCertificateUrl.startsWith("http")).toBe(false);
  });

  test("works for a company-owner token where id IS the companyId (no companyId claim)", async () => {
    const res = mockRes();
    await companyCtrl.getCompanyProfile({ user: { id: companyId, role: "company_admin" } }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.identity.businessName).toBe("Acme Agro");
  });

  test("401 with a clear message when the session has no company id", async () => {
    const res = mockRes();
    await companyCtrl.getCompanyProfile({ user: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/no company/i);
  });

  test("missing docs come back null (empty state), not broken links", async () => {
    const bare = (await Company.create({ fullName: "Bare", password: "x", companyInfo: { companyName: "Bare Co" } }))._id;
    const res = mockRes();
    await companyCtrl.getCompanyProfile({ user: { id: bare, companyId: bare } }, res);
    expect(res.body.data.compliance.gstCertificateUrl).toBeNull();
    expect(res.body.data.compliance.panFileUrl).toBeNull();
  });

  test("PATCH edits identity/compliance + replaces a doc, returns fresh signed urls", async () => {
    const res = mockRes();
    await companyCtrl.updateCompanyProfile({
      user: { id: companyId, companyId },
      body: { businessName: "Acme Agro Pvt Ltd", email: "new@acme.com", phone: "9899999999", gstin: "23ABCDE1234F1Z5", pan: "ABCDE1234F" },
      files: { gstCertificate: [{ buffer: Buffer.from("pdf"), originalname: "gst.pdf", mimetype: "application/pdf" }] },
    }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.identity.businessName).toBe("Acme Agro Pvt Ltd");
    expect(res.body.data.identity.email).toBe("new@acme.com");
    expect(res.body.data.compliance.gstCertificateUrl).toMatch(/^\/uploads\/companies\//);
    // persisted
    const reloaded = mockRes();
    await companyCtrl.getCompanyProfile({ user: { id: companyId, companyId } }, reloaded);
    expect(reloaded.body.data.identity.businessName).toBe("Acme Agro Pvt Ltd");
    expect(reloaded.body.data.compliance.gstCertificateUrl).toMatch(/^\/uploads\/companies\//);
  });

  test("PATCH rejects an invalid GSTIN / PAN with a 400", async () => {
    const r1 = mockRes();
    await companyCtrl.updateCompanyProfile({ user: { id: companyId, companyId }, body: { gstin: "NOTAGSTIN" }, files: {} }, r1);
    expect(r1.statusCode).toBe(400);
    const r2 = mockRes();
    await companyCtrl.updateCompanyProfile({ user: { id: companyId, companyId }, body: { pan: "BAD" }, files: {} }, r2);
    expect(r2.statusCode).toBe(400);
  });

  test("PATCH 401 when the session has no company id (can't edit without a token owner)", async () => {
    const res = mockRes();
    await companyCtrl.updateCompanyProfile({ user: {}, body: { businessName: "x" }, files: {} }, res);
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /seller/profile — registration details + signed KYC docs", () => {
  let sellerId;
  beforeEach(async () => {
    sellerId = (await Seller.create({
      email: "acct@seed.com", phone: "9700000000", passwordHash: "x", status: "active", linkStatus: "approved",
      sellerInfo: { businessName: "Jain Beej Bhandar" },
      contact: { ownerName: "Mahesh Jain", officialEmail: "mahesh@jain.com", officialPhone: "9733333333", address: { line: "Krishi Mandi", city: "Dhule", state: "MH", pincode: "424001" } },
      verification: { gstin: "27ABCDE1234F1Z5", pan: "ABCDE5678K", udyam: "UDYAM-MH-01-0001234", docs: ["sellers/legacy/extra.pdf"] },
    }))._id;
    await SellerDocument.create({ sellerId, docType: "gst", label: "GST Certificate", fileKey: "sellers/x/gst.pdf", fileName: "gst.pdf", mimeType: "application/pdf", status: "verified" });
    await SellerDocument.create({ sellerId, docType: "pan", label: "PAN Card", fileKey: "sellers/x/pan.jpg", fileName: "pan.jpg", mimeType: "image/jpeg", status: "pending" });
  });

  test("resolves the seller from the token and signs gst/pan + other docs", async () => {
    const res = mockRes();
    await sellerAuth.getSellerProfile({ user: { id: sellerId, sellerId, principalType: "seller", role: "seller_admin" } }, res);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.identity.businessName).toBe("Jain Beej Bhandar");
    expect(d.identity.contactPerson).toBe("Mahesh Jain");
    expect(d.identity.email).toBe("mahesh@jain.com");
    expect(d.identity.address).toBe("Krishi Mandi, Dhule, MH, 424001");
    expect(d.compliance.gstin).toBe("27ABCDE1234F1Z5");
    expect(d.compliance.pan).toBe("ABCDE5678K");
    expect(d.compliance.gstCertificateUrl).toBe("/uploads/sellers/x/gst.pdf");
    expect(d.compliance.panFileUrl).toBe("/uploads/sellers/x/pan.jpg");
    // structured docs + the legacy verification.docs[] entry are all listed
    expect(d.documents.length).toBe(3);
    expect(d.documents.some((x) => x.url === "/uploads/sellers/legacy/extra.pdf")).toBe(true);
  });

  test("401 when the session carries no seller id", async () => {
    const res = mockRes();
    await sellerAuth.getSellerProfile({ user: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toMatch(/no seller/i);
  });

  test("PATCH edits identity/compliance + replaces the GST doc in place (no duplicate row)", async () => {
    const res = mockRes();
    await sellerAuth.updateSellerProfile({
      user: { id: sellerId, sellerId, principalType: "seller", role: "seller_admin" },
      body: { businessName: "Jain Beej Bhandar LLP", contactPerson: "Mahesh K Jain", address: "New Mandi Road", gstin: "27ABCDE1234F1Z5", pan: "ABCDE5678K" },
      files: { gstCertificate: [{ buffer: Buffer.from("pdf"), originalname: "new-gst.pdf", mimetype: "application/pdf" }] },
    }, res);
    expect(res.body.success).toBe(true);
    expect(res.body.data.identity.businessName).toBe("Jain Beej Bhandar LLP");
    expect(res.body.data.identity.contactPerson).toBe("Mahesh K Jain");
    expect(res.body.data.identity.address).toMatch(/New Mandi Road/);
    expect(res.body.data.compliance.gstCertificateUrl).toMatch(/^\/uploads\/sellers\//);

    // gst replaced IN PLACE: still exactly one gst SellerDocument
    const gstDocs = await SellerDocument.find({ sellerId, docType: "gst" });
    expect(gstDocs.length).toBe(1);
    expect(gstDocs[0].fileName).toBe("new-gst.pdf");
    expect(gstDocs[0].status).toBe("pending");
  });

  test("PATCH adds an extra (other) document", async () => {
    const before = await SellerDocument.countDocuments({ sellerId, docType: "other" });
    const res = mockRes();
    await sellerAuth.updateSellerProfile({
      user: { id: sellerId, sellerId, principalType: "seller", role: "seller_admin" },
      body: {},
      files: { otherDocs: [{ buffer: Buffer.from("x"), originalname: "license.pdf", mimetype: "application/pdf" }] },
    }, res);
    expect(res.body.success).toBe(true);
    const after = await SellerDocument.countDocuments({ sellerId, docType: "other" });
    expect(after).toBe(before + 1);
  });

  test("PATCH rejects an invalid GSTIN with a 400", async () => {
    const res = mockRes();
    await sellerAuth.updateSellerProfile({ user: { id: sellerId, sellerId, principalType: "seller" }, body: { gstin: "bad" }, files: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  test("PATCH 401 when the session carries no seller id", async () => {
    const res = mockRes();
    await sellerAuth.updateSellerProfile({ user: {}, body: { businessName: "x" }, files: {} }, res);
    expect(res.statusCode).toBe(401);
  });
});
