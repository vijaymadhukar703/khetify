const sellerReportService = require("../../services/sellerReportService");
const { warehouseScope, inScope } = require("../../services/warehouseScope");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Seller report error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/** GET /api/seller/reports — the available report names. */
exports.list = (req, res) => {
  res.json({ success: true, data: Object.keys(sellerReportService.REPORTS).map((name) => ({ name })) });
};

/** GET /api/seller/reports/:name?from&to&warehouseId&format=csv — owner +
 * warehouse-scoped. A scoped manager can't widen past their warehouse(s). */
exports.run = async (req, res) => {
  try {
    const name = req.params.name;
    if (!sellerReportService.REPORTS[name]) return res.status(404).json({ success: false, message: "Unknown report" });

    const scope = await warehouseScope(req.user); // null for seller_admin (all)
    if (scope && req.query.warehouseId && !inScope(scope, req.query.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    const params = {
      from: req.query.from, to: req.query.to, warehouseId: req.query.warehouseId, type: req.query.type,
      ...(scope && { warehouseIds: scope }),
    };
    const rows = await sellerReportService.runReport(name, req.user.sellerId, params);

    if (req.query.format === "csv") return sellerReportService.streamCsv(res, name, rows);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/reports/dashboard — headline KPIs (MRP), warehouse-scoped. */
exports.dashboard = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const data = await sellerReportService.dashboard(req.user.sellerId, { ...(scope && { warehouseIds: scope }) });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
};
