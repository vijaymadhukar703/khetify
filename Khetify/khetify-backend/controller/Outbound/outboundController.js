const pickService = require("../../services/pickService");
const packService = require("../../services/packService");
const dispatchService = require("../../services/dispatchService");
const audit = require("../../services/auditService");

const fail = (res, err) => {
  // Surface Mongoose validation/cast errors (e.g. a missing required line field
  // or a bad id) as a 400 with the offending field path, not a generic 500
  // "Validation failed".
  const status = (err.name === "ValidationError" || err.name === "CastError") ? 400 : (err.status || 500);
  if (status >= 500) console.error("Outbound error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/* ---- pick ---- */
exports.generateWave = async (req, res) => {
  try {
    const pl = await pickService.generateWave(req.user.companyId, req.body);
    res.status(201).json({ success: true, message: `Wave ${pl.waveNumber} · ${pl.lines.length} line(s)`, data: pl });
  } catch (err) { fail(res, err); }
};
exports.listPickLists = async (req, res) => {
  try { const rows = await pickService.listPickLists(req.user.companyId, req.query); res.json({ success: true, count: rows.length, data: rows }); }
  catch (err) { fail(res, err); }
};
exports.getPickList = async (req, res) => {
  try { res.json({ success: true, data: await pickService.getPickList(req.user.companyId, req.params.id) }); }
  catch (err) { fail(res, err); }
};
exports.pickLine = async (req, res) => {
  try {
    const { lineIndex, ...rest } = req.body;
    const pl = await pickService.pickLine(req.user.companyId, req.params.id, lineIndex, { ...rest, performedBy: req.user.id });
    res.json({ success: true, message: "Picked", data: pl });
  } catch (err) { fail(res, err); }
};
// Direct scan-pick a confirmed order — no wave/PickList.
exports.pickOrder = async (req, res) => {
  try {
    const order = await pickService.pickOrderDirect(req.user.companyId, req.params.id, { picks: req.body.picks, performedBy: req.user.id });
    res.json({ success: true, message: "Picked", data: order });
  } catch (err) { fail(res, err); }
};

/* ---- pack ---- */
exports.createPackage = async (req, res) => {
  try {
    const pkg = await packService.createPackage(req.user.companyId, { ...req.body, performedBy: req.user.id });
    res.status(201).json({ success: true, message: `Packed ${pkg.packageNumber}`, data: pkg });
  } catch (err) { fail(res, err); }
};
exports.listPackages = async (req, res) => {
  try { const rows = await packService.listPackages(req.user.companyId, req.query); res.json({ success: true, count: rows.length, data: rows }); }
  catch (err) { fail(res, err); }
};

/* ---- dispatch ---- */
exports.dispatch = async (req, res) => {
  try {
    const r = await dispatchService.dispatch(req.user.companyId, { ...req.body, performedBy: req.user.id });
    await audit.log({ req, action: "order.dispatched", entityType: "Order", entityId: req.body.orderId, after: { shipmentId: r.shipment._id } });
    res.json({ success: true, message: "Dispatched", data: r });
  } catch (err) { fail(res, err); }
};
