const returnService = require("../../services/returnService");
const audit = require("../../services/auditService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Return error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

exports.list = async (req, res) => {
  try {
    const rows = await returnService.listReturns(req.user.companyId, req.query);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.create = async (req, res) => {
  try {
    const ret = await returnService.createReturn(req.user.companyId, req.body);
    await audit.log({ req, action: "return.created", entityType: "ReturnOrder", entityId: ret._id, after: { returnNumber: ret.returnNumber } });
    res.status(201).json({ success: true, message: "Return created", data: ret });
  } catch (err) { fail(res, err); }
};

exports.post = async (req, res) => {
  try {
    const { ret, grnId } = await returnService.postReturn(req.user.companyId, req.params.id, { performedBy: req.user.id });
    await audit.log({ req, action: "return.posted", entityType: "ReturnOrder", entityId: ret._id, after: { returnNumber: ret.returnNumber, grnId } });
    res.json({ success: true, message: "Return posted", data: ret });
  } catch (err) { fail(res, err); }
};
