const svc = require("../../services/cycleCountService");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const audit = require("../../services/auditService");
const { hasCapability } = require("../../config/permissions");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("CycleCount error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

exports.list = async (req, res) => {
  try {
    // Warehouse-level access: scoped users only see counts for their warehouses.
    const scope = await warehouseScope(req.user);
    if (scope && req.query.warehouseId && !inScope(scope, req.query.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    const rows = await svc.listCounts(req.user.companyId, { ...req.query, ...(scope && { warehouseIds: scope }) });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.get = async (req, res) => {
  try {
    const cc = await svc.getCount(req.user.companyId, req.params.id);
    // Blind counting: hide systemQty from counters (those without count:review).
    const canSeeSystem = hasCapability(req.user.role, "count:review");
    const out = cc.toObject();
    if (!canSeeSystem) {
      out.lines = out.lines.map((l) => {
        const { systemQty, varianceAdjustmentId, ...rest } = l;
        return rest;
      });
      out.blind = true;
    }
    res.json({ success: true, data: out });
  } catch (err) { fail(res, err); }
};

exports.generate = async (req, res) => {
  try {
    const cc = await svc.generateCount(req.user.companyId, { ...req.body, createdBy: req.user.id });
    await audit.log({ req, action: "cyclecount.generated", entityType: "CycleCount", entityId: cc._id, after: { countNumber: cc.countNumber, type: cc.type, freeze: cc.freeze, lines: cc.lines.length } });
    res.status(201).json({ success: true, message: `Count ${cc.countNumber} generated with ${cc.lines.length} line(s)`, data: cc });
  } catch (err) { fail(res, err); }
};

exports.submit = async (req, res) => {
  try {
    const cc = await svc.submitCount(req.user.companyId, req.params.id, { ...req.body, countedBy: req.user.id });
    res.json({ success: true, message: "Counts recorded", data: { _id: cc._id, status: cc.status } });
  } catch (err) { fail(res, err); }
};

exports.complete = async (req, res) => {
  try {
    const { count, adjustmentsCreated } = await svc.completeCount(req.user.companyId, req.params.id, { performedBy: req.user.id });
    await audit.log({ req, action: "cyclecount.completed", entityType: "CycleCount", entityId: count._id, after: { adjustmentsCreated } });
    res.json({ success: true, message: `Count completed · ${adjustmentsCreated} variance adjustment(s) created`, data: { _id: count._id, adjustmentsCreated } });
  } catch (err) { fail(res, err); }
};

exports.cancel = async (req, res) => {
  try {
    const cc = await svc.cancelCount(req.user.companyId, req.params.id);
    res.json({ success: true, message: "Count cancelled", data: { _id: cc._id, status: cc.status } });
  } catch (err) { fail(res, err); }
};
