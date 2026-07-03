const Shipment = require("../../model/Transport/Shipment");

/** GET /api/transport?status= */
exports.getShipments = async (req, res) => {
  try {
    const filter = { companyId: req.user.companyId };
    if (req.query.status) filter.status = req.query.status;
    const rows = await Shipment.find(filter)
      .populate("fromWarehouseId", "name")
      .sort({ createdAt: -1 })
      .limit(300);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getShipments error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST /api/transport */
exports.createShipment = async (req, res) => {
  try {
    if (!req.body.toLabel) {
      return res.status(400).json({ success: false, message: "toLabel (destination) is required" });
    }
    const shp = await Shipment.create({
      ...req.body,
      companyId: req.user.companyId,
      status: req.body.vehicleNo ? "in_transit" : "pending",
      dispatchedAt: req.body.vehicleNo ? new Date() : null,
    });
    res.json({ success: true, message: "Shipment created", data: shp });
  } catch (err) {
    console.error("createShipment error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** PATCH /api/transport/:id/status  { status } */
exports.updateShipmentStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const patch = { status };
    if (status === "in_transit") patch.dispatchedAt = new Date();
    if (status === "delivered") patch.deliveredAt = new Date();
    const shp = await Shipment.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId },
      patch,
      { new: true }
    );
    if (!shp) return res.status(404).json({ success: false, message: "Shipment not found" });
    res.json({ success: true, message: "Status updated", data: shp });
  } catch (err) {
    console.error("updateShipmentStatus error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
