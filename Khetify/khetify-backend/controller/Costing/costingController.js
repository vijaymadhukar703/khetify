const ProductCost = require("../../model/Costing/ProductCost");
const svc = require("../../services/costingService");
const audit = require("../../services/auditService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Costing error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/** GET /api/costing — product cost rows (with any pending change). */
exports.list = async (req, res) => {
  try {
    const rows = await ProductCost.find({ companyId: req.user.companyId }).populate("productId", "productName skuNumber");
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** POST /api/costing/:productId/request */
exports.requestChange = async (req, res) => {
  try {
    const doc = await svc.requestCostChange({ user: req.user, productId: req.params.productId, change: req.body, note: req.body.note });
    await audit.log({ req, action: "cost.change_requested", entityType: "ProductCost", entityId: doc._id, after: doc.pendingChange });
    res.json({ success: true, message: "Cost change submitted for owner approval", data: doc });
  } catch (err) { fail(res, err); }
};

/** POST /api/costing/:productId/approve  { approve: true|false } */
exports.approveChange = async (req, res) => {
  try {
    const approve = req.body.approve !== false;
    const doc = await svc.approveCostChange({ user: req.user, productId: req.params.productId, approve });
    await audit.log({ req, action: approve ? "cost.change_approved" : "cost.change_rejected", entityType: "ProductCost", entityId: doc._id, after: { totalCost: doc.totalCost } });
    res.json({ success: true, message: approve ? "Cost change approved" : "Cost change rejected", data: doc });
  } catch (err) { fail(res, err); }
};

/** GET /api/costing/profitability?from=&to= */
exports.profitability = async (req, res) => {
  try {
    const rows = await svc.productProfitability({ companyId: req.user.companyId, from: req.query.from, to: req.query.to });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** GET /api/costing/valuation?warehouseId= */
exports.valuation = async (req, res) => {
  try {
    const out = await svc.inventoryValuation({ companyId: req.user.companyId, warehouseId: req.query.warehouseId });
    res.json({ success: true, data: out });
  } catch (err) { fail(res, err); }
};
