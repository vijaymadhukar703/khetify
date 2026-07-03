const Company = require("../../model/Company/Company");
const PCApplication = require("../../model/PC/PCApplication");
const PrincipalCertificate = require("../../model/PC/PrincipalCertificate");
const Subscription = require("../../model/Company/Subscription/Subscription");
const { effectivePlan } = require("../../services/subscriptionService");

const companyName = (c) => c?.companyInfo?.companyName || c?.fullName || "Company";
const companyLocation = (c) => c?.businessContact?.region || c?.businessContact?.address || null;
const companyView = (c) => ({ _id: c._id, businessName: companyName(c), location: companyLocation(c) });
const COMPANY_SELECT = "companyInfo.companyName fullName businessContact.region businessContact.address";

/** Companies the seller is already ENGAGED with — an in-progress PC application
 * (non-terminal) OR an active PC. Used to exclude them from the apply search. */
async function engagedCompanyIds(sellerId) {
  const [apps, certs] = await Promise.all([
    PCApplication.find({ sellerId, status: { $in: PCApplication.ACTIVE_STATUSES } }).select("companyId"),
    PrincipalCertificate.find({ sellerId, status: "active" }).select("companyId"),
  ]);
  return [...new Set([...apps.map((a) => String(a.companyId)), ...certs.map((c) => String(c.companyId))])];
}

/**
 * GET /api/seller/companies[?status=active]
 * The seller's COMPANIES — derived from PC issuance (the authorization). Each
 * company the seller has applied to or holds a PC from, annotated with its PC
 * status (active = certificate issued). `?status=active` narrows to issued PCs.
 */
exports.getSellerCompanyLinks = async (req, res) => {
  try {
    const sellerId = req.user.sellerId;
    const apps = await PCApplication.find({ sellerId })
      .sort({ updatedAt: -1 })
      .populate({ path: "companyId", select: COMPANY_SELECT });
    const activeCerts = await PrincipalCertificate.find({ sellerId, status: "active" }).populate({ path: "companyId", select: COMPANY_SELECT });
    const activeByCompany = new Map();
    for (const c of activeCerts) if (c.isCurrentlyActive() && c.companyId) activeByCompany.set(String(c.companyId._id), c);

    // One row per company: prefer the active cert, else the latest application.
    const seen = new Set();
    const rows = [];
    for (const cert of activeCerts) {
      if (!cert.companyId || !cert.isCurrentlyActive()) continue;
      const id = String(cert.companyId._id);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ ...companyView(cert.companyId), status: "active", pcNumber: cert.pcNumber, pcStatus: "active" });
    }
    for (const app of apps) {
      if (!app.companyId) continue;
      const id = String(app.companyId._id);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ ...companyView(app.companyId), status: app.status, applicationId: app._id, rejectionReason: app.rejectionReason || null });
    }

    let data = rows;
    if (req.query.status === "active") data = rows.filter((r) => r.status === "active");
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/seller/companies/search?q=
 * Approved companies the seller is NOT already engaged with (no in-progress PC
 * application / active PC) — candidates to apply to for a PC.
 */
exports.searchSellerCompanies = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const engaged = await engagedCompanyIds(req.user.sellerId);
    const filter = { status: "approved", _id: { $nin: engaged } };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ "companyInfo.companyName": rx }, { fullName: rx }, { "businessContact.region": rx }];
    }
    const companies = await Company.find(filter).select(COMPANY_SELECT).sort({ "companyInfo.companyName": 1 }).limit(20).lean();
    res.json({ success: true, count: companies.length, data: companies.map(companyView) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/seller/companies/recommended
 * Approved companies the seller isn't engaged with yet, RANKED so IMS-subscribed
 * companies surface first — candidates to apply to for a PC.
 */
exports.getRecommendedCompanies = async (req, res) => {
  try {
    const engaged = await engagedCompanyIds(req.user.sellerId);
    const companies = await Company.find({ status: "approved", _id: { $nin: engaged } })
      .select(`${COMPANY_SELECT} subscription`)
      .lean();
    if (!companies.length) return res.json({ success: true, count: 0, data: [] });

    const ids = companies.map((c) => c._id);
    const subs = await Subscription.find({ ownerType: "company", ownerId: { $in: ids } })
      .select("ownerId plan status currentPeriodEnd")
      .lean();
    const subMap = new Map(subs.map((s) => [String(s.ownerId), s]));
    const planOf = (c) => {
      const s = subMap.get(String(c._id));
      if (s) return effectivePlan(s);
      return c.subscription === "paid" ? "pro" : "free";
    };

    const data = companies
      .map((c) => {
        const plan = planOf(c);
        return { ...companyView(c), subscribed: plan !== "free", plan };
      })
      .sort((a, b) => (Number(b.subscribed) - Number(a.subscribed)) || a.businessName.localeCompare(b.businessName))
      .slice(0, 12);

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
