const svc = require("../../services/adjustmentService");
const audit = require("../../services/auditService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Adjustment error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

exports.list = async (req, res) => {
  try {
    const rows = await svc.listAdjustments(req.user.companyId, req.query);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.create = async (req, res) => {
  try {
    const adj = await svc.createAdjustment(req.user.companyId, { ...req.body, requestedBy: req.user.id });
    await audit.log({ req, action: "adjustment.requested", entityType: "Adjustment", entityId: adj._id, after: { qtyDelta: adj.qtyDelta, reason: adj.reason } });
    res.status(201).json({ success: true, message: "Adjustment requested", data: adj });
  } catch (err) { fail(res, err); }
};

exports.approve = async (req, res) => {
  try {
    const adj = await svc.approveAdjustment(req.user.companyId, req.params.id, { approverId: req.user.id });
    await audit.log({ req, action: "adjustment.approved", entityType: "Adjustment", entityId: adj._id, after: { qtyDelta: adj.qtyDelta } });
    res.json({ success: true, message: "Adjustment approved & applied", data: adj });
  } catch (err) { fail(res, err); }
};

exports.reject = async (req, res) => {
  try {
    const adj = await svc.rejectAdjustment(req.user.companyId, req.params.id, { approverId: req.user.id });
    await audit.log({ req, action: "adjustment.rejected", entityType: "Adjustment", entityId: adj._id });
    res.json({ success: true, message: "Adjustment rejected", data: adj });
  } catch (err) { fail(res, err); }
};
