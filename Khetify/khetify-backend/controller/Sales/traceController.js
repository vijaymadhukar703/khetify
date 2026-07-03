const svc = require("../../services/traceService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Trace error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

exports.serial = async (req, res) => {
  try { res.json({ success: true, data: await svc.traceSerial(req.user.companyId, req.params.serial) }); }
  catch (err) { fail(res, err); }
};

exports.lot = async (req, res) => {
  try { res.json({ success: true, data: await svc.traceLot(req.user.companyId, req.params.lotNumber) }); }
  catch (err) { fail(res, err); }
};

exports.invoice = async (req, res) => {
  try { res.json({ success: true, data: await svc.traceInvoice(req.user.companyId, req.params.invoiceNumber) }); }
  catch (err) { fail(res, err); }
};
