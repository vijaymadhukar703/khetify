const grnService = require("../../services/grnService");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const audit = require("../../services/auditService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("GRN error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

exports.list = async (req, res) => {
  try {
    // Warehouse-level access: scoped users only see inbound for their warehouses.
    const scope = await warehouseScope(req.user);
    const rows = await grnService.listGRNs(req.user.companyId, { ...req.query, ...(scope && { warehouseIds: scope }) });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.get = async (req, res) => {
  try {
    const grn = await grnService.getGRN(req.user.companyId, req.params.id);
    res.json({ success: true, data: grn });
  } catch (err) { fail(res, err); }
};

exports.create = async (req, res) => {
  try {
    // Warehouse-level access: a scoped user can only receive into their own warehouse.
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, req.body.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    const grn = await grnService.createGRN(req.user.companyId, req.body);
    await audit.log({ req, action: "grn.created", entityType: "GRN", entityId: grn._id, after: { grnNumber: grn.grnNumber, refType: grn.refType } });
    res.status(201).json({ success: true, message: "GRN created", data: grn });
  } catch (err) { fail(res, err); }
};

exports.receive = async (req, res) => {
  try {
    const grn = await grnService.receiveGRN(req.user.companyId, req.params.id, { ...req.body, receivedBy: req.user.id });
    res.json({ success: true, message: "GRN received", data: grn });
  } catch (err) { fail(res, err); }
};

exports.post = async (req, res) => {
  try {
    const { grn, putawayTasks } = await grnService.postGRN(req.user.companyId, req.params.id, { performedBy: req.user.id });
    await audit.log({ req, action: "grn.posted", entityType: "GRN", entityId: grn._id, after: { grnNumber: grn.grnNumber, status: grn.status, putawayTasks } });
    res.json({ success: true, message: `GRN posted · ${putawayTasks} putaway task(s) created`, data: grn });
  } catch (err) { fail(res, err); }
};

exports.writeoff = async (req, res) => {
  try {
    const inv = await grnService.writeOffDamaged(req.user.companyId, { ...req.body, performedBy: req.user.id });
    await audit.log({ req, action: "damage.written_off", entityType: "Inventory", entityId: inv._id, after: { qty: req.body.qty, reason: req.body.reason } });
    res.json({ success: true, message: "Damaged stock written off", data: inv });
  } catch (err) { fail(res, err); }
};
