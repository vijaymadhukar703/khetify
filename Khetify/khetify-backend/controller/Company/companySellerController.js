const Seller = require("../../model/Seller/Seller");
const PrincipalCertificate = require("../../model/PC/PrincipalCertificate");

/** Safe seller view for the company (no auth/credentials, no other company's data). */
function sellerForCompany(s, cert) {
  return {
    _id: s._id,
    businessName: s.sellerInfo?.businessName || "—",
    contact: s.contact || {},
    email: s.email,
    phone: s.phone,
    // The relationship is now defined by the Principal Certificate.
    pcNumber: cert?.pcNumber || null,
    pcStatus: cert?.status || null,
    linkStatus: "approved", // kept for UI compatibility — these are the active resellers
    approvedAt: cert?.issuedAt || null,
  };
}

/**
 * GET /api/company/sellers
 * Lists this company's APPROVED RESELLERS — the sellers it has ISSUED an active
 * Principal Certificate to. Issuing a PC IS the authorization; there is no
 * separate link-approval. Sellers apply via the PC Applications queue.
 */
exports.listSellers = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const certs = await PrincipalCertificate.find({ companyId, status: "active" });
    const active = certs.filter((c) => c.isCurrentlyActive());
    const certBySeller = new Map(active.map((c) => [String(c.sellerId), c]));

    const sellers = await Seller.find({ _id: { $in: active.map((c) => c.sellerId) } })
      .select("sellerInfo contact email phone")
      .lean();

    const data = sellers
      .map((s) => sellerForCompany(s, certBySeller.get(String(s._id))))
      .sort((a, b) => new Date(b.approvedAt || 0) - new Date(a.approvedAt || 0));

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
