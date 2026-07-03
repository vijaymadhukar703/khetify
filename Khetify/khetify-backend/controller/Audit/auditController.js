const AuditLog = require("../../model/Audit/AuditLog");
const { runReconciliation } = require("../../services/reconciliationService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Audit error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/** GET /api/audit?entityType=&limit= — the append-only audit trail. */
exports.list = async (req, res) => {
  try {
    const filter = { companyId: req.user.companyId };
    if (req.query.entityType) filter.entityType = req.query.entityType;
    const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 200, 1000));
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** POST /api/audit/reconcile — ledger-vs-stock reconciliation report. */
exports.reconcile = async (req, res) => {
  try {
    const r = await runReconciliation(req.user.companyId);
    res.json({ success: true, message: `${r.mismatchCount} mismatch(es) across ${r.checkedRows} row(s)`, data: r });
  } catch (err) { fail(res, err); }
};
