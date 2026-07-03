const PDFDocument = require("pdfkit");

/** Run a pdfkit draw function and resolve the finished PDF as a Buffer. */
function render(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try { draw(doc); doc.end(); } catch (e) { reject(e); }
  });
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const BRAND = "#EA2831";

function heading(doc, title, subtitle) {
  doc.fillColor(BRAND).fontSize(22).font("Helvetica-Bold").text("Khetify", { continued: false });
  doc.fillColor("#111").fontSize(16).font("Helvetica-Bold").text(title);
  if (subtitle) doc.fillColor("#666").fontSize(10).font("Helvetica").text(subtitle);
  doc.moveDown(0.5);
  doc.strokeColor("#ddd").moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.8);
  doc.fillColor("#111");
}

function kv(doc, label, value) {
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#444").text(`${label}: `, { continued: true });
  doc.font("Helvetica").fillColor("#111").text(String(value ?? "—"));
}

/**
 * Authorization agreement. `signed` (optional) stamps the signer + timestamp.
 * Returns a Buffer.
 */
function agreementPdf({ company, sellerName, gstin, pan, address, productCategories = [], termsText, validityText, signed }) {
  return render((doc) => {
    heading(doc, "Reseller Authorization Agreement", `${company} ⟷ ${sellerName}`);

    kv(doc, "Principal (Company)", company);
    kv(doc, "Authorized Reseller", sellerName);
    kv(doc, "GSTIN", gstin);
    kv(doc, "PAN", pan);
    kv(doc, "Address", address);
    kv(doc, "Authorized product categories", productCategories.length ? productCategories.join(", ") : "All listed");
    if (validityText) kv(doc, "Validity", validityText);
    doc.moveDown(0.8);

    doc.fontSize(11).font("Helvetica-Bold").fillColor("#111").text("Terms");
    doc.moveDown(0.3);
    doc.fontSize(9.5).font("Helvetica").fillColor("#333").text(termsText, { align: "justify" });
    doc.moveDown(1.2);

    if (signed) {
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#0a7d33")
        .text(`Digitally signed by ${signed.signedName} on ${fmtDate(signed.signedAt)}`);
      doc.fontSize(8).font("Helvetica").fillColor("#666").text(`Consent recorded · IP ${signed.ip || "n/a"}`);
    } else {
      doc.fontSize(10).font("Helvetica").fillColor("#111").text("Authorized signatory: ____________________________");
      doc.moveDown(0.3);
      doc.text("Date: ______________");
    }
  });
}

/** Principal Certificate. Returns a Buffer. */
function certificatePdf({ pcNumber, company, sellerName, productCategories = [], brandName, validFrom, validUntil, issuedAt }) {
  return render((doc) => {
    doc.rect(30, 30, 535, 782).lineWidth(2).strokeColor(BRAND).stroke();
    doc.moveDown(1);
    doc.fillColor(BRAND).fontSize(26).font("Helvetica-Bold").text("Khetify", { align: "center" });
    doc.fillColor("#111").fontSize(18).font("Helvetica-Bold").text("Principal Certificate", { align: "center" });
    doc.fillColor("#666").fontSize(11).font("Helvetica").text("Certificate of Authorized Reseller", { align: "center" });
    doc.moveDown(1.5);

    doc.fillColor("#111").fontSize(12).font("Helvetica").text("This certifies that", { align: "center" });
    doc.fontSize(20).font("Helvetica-Bold").fillColor(BRAND).text(sellerName, { align: "center" });
    doc.fontSize(12).font("Helvetica").fillColor("#111").text("is an authorized reseller of products supplied by", { align: "center" });
    doc.fontSize(16).font("Helvetica-Bold").text(company, { align: "center" });
    doc.moveDown(1.2);

    doc.fontSize(10);
    kv(doc, "Certificate No.", pcNumber);
    if (brandName) kv(doc, "Brand", brandName);
    kv(doc, "Authorized categories", productCategories.length ? productCategories.join(", ") : "All listed");
    kv(doc, "Valid from", fmtDate(validFrom));
    kv(doc, "Valid until", fmtDate(validUntil));
    kv(doc, "Issued on", fmtDate(issuedAt));
    doc.moveDown(2);

    doc.fontSize(9).fillColor("#888").font("Helvetica")
      .text(`Authenticity reference: ${pcNumber}`, { align: "center" });
    doc.text("Verify this certificate with the issuing company.", { align: "center" });
  });
}

module.exports = { agreementPdf, certificatePdf };
