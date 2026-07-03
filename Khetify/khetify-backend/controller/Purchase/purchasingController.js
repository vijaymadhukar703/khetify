const Vendor = require("../../model/Vendor/Vendor");
const PurchaseOrder = require("../../model/Purchase/PurchaseOrder");

/* ---------------- vendors ---------------- */

exports.getVendors = async (req, res) => {
  try {
    const rows = await Vendor.find({ companyId: req.user.companyId }).sort({ createdAt: -1 });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getVendors error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createVendor = async (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ success: false, message: "Vendor name is required" });
    const vendor = await Vendor.create({ ...req.body, companyId: req.user.companyId });
    res.json({ success: true, message: "Vendor added", data: vendor });
  } catch (err) {
    console.error("createVendor error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------- purchase orders ---------------- */

exports.getPurchaseOrders = async (req, res) => {
  try {
    const filter = { companyId: req.user.companyId };
    if (req.query.status) filter.status = req.query.status;
    const rows = await PurchaseOrder.find(filter)
      .populate("vendorId", "name")
      .sort({ createdAt: -1 });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getPurchaseOrders error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createPurchaseOrder = async (req, res) => {
  try {
    const { vendorId, items, expectedDate } = req.body;
    if (!vendorId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "vendorId and at least one item are required" });
    }
    const totalAmount = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
    const count = await PurchaseOrder.countDocuments({ companyId: req.user.companyId });
    const po = await PurchaseOrder.create({
      companyId: req.user.companyId,
      vendorId,
      poNumber: `PO-${1001 + count}`,
      items,
      totalAmount,
      expectedDate: expectedDate || null,
      status: "draft",
    });
    res.json({ success: true, message: "Purchase order created", data: po });
  } catch (err) {
    console.error("createPurchaseOrder error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const PO_TRANSITIONS = { draft: ["sent", "cancelled"], sent: ["received", "cancelled"], received: [], cancelled: [] };

exports.updatePurchaseOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const po = await PurchaseOrder.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!po) return res.status(404).json({ success: false, message: "Purchase order not found" });
    if (!(PO_TRANSITIONS[po.status] || []).includes(status)) {
      return res.status(400).json({ success: false, message: `Cannot move PO from "${po.status}" to "${status}".` });
    }
    po.status = status;
    await po.save();
    res.json({ success: true, message: `PO marked ${status}`, data: po });
  } catch (err) {
    console.error("updatePurchaseOrderStatus error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
