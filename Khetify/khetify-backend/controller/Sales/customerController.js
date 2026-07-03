const svc = require("../../services/customerService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Customer error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

// The company is the customer owner for all company-side flows.
const companyOwner = (req) => ({ ownerType: "company", ownerId: req.user.companyId });

exports.list = async (req, res) => {
  try {
    const rows = await svc.listCustomers(companyOwner(req), req.query);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

exports.get = async (req, res) => {
  try {
    const c = await svc.getCustomer(companyOwner(req), req.params.id);
    res.json({ success: true, data: c });
  } catch (err) { fail(res, err); }
};

exports.create = async (req, res) => {
  try {
    const c = await svc.createCustomer(companyOwner(req), req.body);
    res.status(201).json({ success: true, message: "Customer created", data: c });
  } catch (err) { fail(res, err); }
};

exports.update = async (req, res) => {
  try {
    const c = await svc.updateCustomer(companyOwner(req), req.params.id, req.body);
    res.json({ success: true, message: "Customer updated", data: c });
  } catch (err) { fail(res, err); }
};

exports.history = async (req, res) => {
  try {
    const r = await svc.getHistory(companyOwner(req), req.params.id);
    res.json({ success: true, data: r });
  } catch (err) { fail(res, err); }
};
