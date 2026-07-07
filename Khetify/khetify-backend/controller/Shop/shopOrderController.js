const orderService = require("../../services/shopOrderService");

exports.checkout = async (req, res) => {
  try {
    const orders = await orderService.checkout(req.consumer.id, req.body);
    res.status(201).json({
      success: true,
      message: orders.length > 1 ? `${orders.length} orders placed` : "Order placed",
      data: orders,
      count: orders.length,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.listOrders = async (req, res) => {
  try {
    const orders = await orderService.listOrders(req.consumer.id);
    res.json({ success: true, data: orders, count: orders.length });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.getOrder = async (req, res) => {
  try {
    const order = await orderService.getOrder(req.consumer.id, req.params.id);
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.listAddresses = async (req, res) => {
  try {
    const addresses = await orderService.listAddresses(req.consumer.id);
    res.json({ success: true, data: addresses });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.addAddress = async (req, res) => {
  try {
    const addresses = await orderService.addAddress(req.consumer.id, req.body);
    res.status(201).json({ success: true, message: "Address saved", data: addresses });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.deleteAddress = async (req, res) => {
  try {
    const addresses = await orderService.deleteAddress(req.consumer.id, req.params.addressId);
    res.json({ success: true, message: "Address removed", data: addresses });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};
