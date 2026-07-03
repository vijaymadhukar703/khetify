const svc = require("../../services/barcodeService");
const audit = require("../../services/auditService");

// The company is the unit owner for all company-side barcode flows.
const companyOwner = (req) => ({ ownerType: "company", ownerId: req.user.companyId });

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Barcode error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

exports.generate = async (req, res) => {
  try {
    const r = await svc.generateUnits(req.user.companyId, req.body.inventoryId, req.body.qty, { performedBy: req.user.id });
    await audit.log({ req, action: "units.generated", entityType: "Inventory", entityId: req.body.inventoryId, after: r });
    res.status(201).json({ success: true, message: `Generated ${r.generated} unit barcode(s)`, data: r });
  } catch (err) { fail(res, err); }
};

exports.list = async (req, res) => {
  try {
    const rows = await svc.listUnits(companyOwner(req), req.query);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.print = async (req, res) => {
  try {
    const r = await svc.markPrinted(companyOwner(req), req.body.serials, { actorId: req.user.id });
    res.json({ success: true, message: `Marked ${r.moved.length} printed`, data: r });
  } catch (err) { fail(res, err); }
};

exports.transition = async (req, res) => {
  try {
    const r = await svc.transitionUnits(companyOwner(req), req.body.serials, { ...req.body, actorId: req.user.id });
    res.json({ success: true, message: `Moved ${r.moved.length}, skipped ${r.skipped.length}`, data: r });
  } catch (err) { fail(res, err); }
};

exports.history = async (req, res) => {
  try {
    const r = await svc.unitHistory(companyOwner(req), req.params.serial);
    res.json({ success: true, data: r });
  } catch (err) { fail(res, err); }
};

exports.scan = async (req, res) => {
  try {
    const r = await svc.resolveScan(companyOwner(req), req.body.code, req.user.role);
    res.json({ success: true, data: r });
  } catch (err) { fail(res, err); }
};

exports.recall = async (req, res) => {
  try {
    const r = await svc.recall(req.user.companyId, req.body.lotNumber, { performedBy: req.user.id });
    await audit.log({ req, action: "lot.recalled", entityType: "Lot", after: { lotNumber: r.lotNumber, recalledUnits: r.recalledUnits, soldUnits: r.soldUnits } });
    res.json({ success: true, message: `Recalled ${r.recalledUnits} unit(s); ${r.soldUnits} already sold`, data: r });
  } catch (err) { fail(res, err); }
};
