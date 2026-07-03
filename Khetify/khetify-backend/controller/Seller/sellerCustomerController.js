const svc = require("../../services/customerService");
const { validateAndNormalizeCustomer } = require("../../validators/customerValidators");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Seller customer error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

// Every seller customer flow is scoped to the seller as owner.
const sellerOwner = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });

exports.list = async (req, res) => {
  try {
    const rows = await svc.listCustomers(sellerOwner(req), req.query);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.get = async (req, res) => {
  try {
    const c = await svc.getCustomer(sellerOwner(req), req.params.id);
    res.json({ success: true, data: c });
  } catch (err) { fail(res, err); }
};

exports.create = async (req, res) => {
  try {
    const { error, value } = validateAndNormalizeCustomer(req.body, { isUpdate: false });
    if (error) return res.status(400).json({ success: false, message: error });
    const c = await svc.createCustomer(sellerOwner(req), value);
    res.status(201).json({ success: true, message: "Customer created", data: c });
  } catch (err) { fail(res, err); }
};

exports.update = async (req, res) => {
  try {
    const { error, value } = validateAndNormalizeCustomer(req.body, { isUpdate: true });
    if (error) return res.status(400).json({ success: false, message: error });
    const c = await svc.updateCustomer(sellerOwner(req), req.params.id, value);
    res.json({ success: true, message: "Customer updated", data: c });
  } catch (err) { fail(res, err); }
};

exports.history = async (req, res) => {
  try {
    const r = await svc.getHistory(sellerOwner(req), req.params.id);
    res.json({ success: true, data: r });
  } catch (err) { fail(res, err); }
};
