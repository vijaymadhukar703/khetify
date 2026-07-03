const ShipmentCost = require("../../model/Transport/ShipmentCost");
const Shipment = require("../../model/Transport/Shipment");
const { transportAnalytics } = require("../../services/costingService");
const audit = require("../../services/auditService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("ShipmentCost error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/** PUT /api/transport-costs/:shipmentId — upsert the cost breakdown. */
exports.upsert = async (req, res) => {
  try {
    const shp = await Shipment.findOne({ _id: req.params.shipmentId, companyId: req.user.companyId });
    if (!shp) return res.status(404).json({ success: false, message: "Shipment not found" });

    let doc = await ShipmentCost.findOne({ companyId: req.user.companyId, shipmentId: shp._id });
    const before = doc ? doc.toObject() : null;
    if (!doc) doc = new ShipmentCost({ companyId: req.user.companyId, shipmentId: shp._id, warehouseId: shp.fromWarehouseId });
    ["fuelCost", "driverCost", "vehicleCost", "tollCost", "miscellaneousCost", "unitsShipped"].forEach((k) => {
      if (req.body[k] !== undefined) doc[k] = Number(req.body[k]);
    });
    doc.enteredBy = req.user.id;
    await doc.save(); // pre-save computes totalCost + costPerUnit
    await audit.log({ req, action: "shipment_cost.saved", entityType: "ShipmentCost", entityId: doc._id, before, after: doc.toObject() });
    res.json({ success: true, message: "Shipment cost saved", data: doc });
  } catch (err) { fail(res, err); }
};

/** GET /api/transport-costs/:shipmentId */
exports.getOne = async (req, res) => {
  try {
    const doc = await ShipmentCost.findOne({ companyId: req.user.companyId, shipmentId: req.params.shipmentId });
    res.json({ success: true, data: doc });
  } catch (err) { fail(res, err); }
};

/** GET /api/transport-costs/analytics/summary?from=&to= */
exports.analytics = async (req, res) => {
  try {
    const out = await transportAnalytics({ companyId: req.user.companyId, from: req.query.from, to: req.query.to });
    res.json({ success: true, data: out });
  } catch (err) { fail(res, err); }
};
