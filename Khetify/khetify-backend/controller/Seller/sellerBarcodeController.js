const svc = require("../../services/barcodeService");

// Every seller barcode flow is scoped to the seller as the CURRENT unit owner.
// Sellers never generate serials (no generate endpoint) — they view, re-print
// and scan the units they received via supply.
const sellerOwner = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/** GET /api/seller/units?inventoryId=&lotNumber=&status= */
exports.listUnits = async (req, res) => {
  try {
    const rows = await svc.listUnits(sellerOwner(req), req.query);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/units/print { serials } — (re)print labels. */
exports.print = async (req, res) => {
  try {
    const r = await svc.markPrinted(sellerOwner(req), req.body.serials, { actorId: req.user.id });
    res.json({ success: true, message: `Marked ${r.moved.length} printed`, data: r });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/scan { code } */
exports.scan = async (req, res) => {
  try {
    const r = await svc.resolveScan(sellerOwner(req), req.body.code, req.user.role);
    res.json({ success: true, data: r });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/units/:serial/history */
exports.history = async (req, res) => {
  try {
    const r = await svc.unitHistory(sellerOwner(req), req.params.serial);
    res.json({ success: true, data: r });
  } catch (err) { fail(res, err); }
};
