const svc = require("../../services/locationService");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const InventoryBin = require("../../model/Inventory/InventoryBin");
const audit = require("../../services/auditService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("location error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/** GET /api/locations?warehouseId&type */
exports.list = async (req, res) => {
  try {
    const q = req.validatedQuery || req.query;
    // Warehouse-level access: scoped users only see their warehouses' locations.
    const scope = await warehouseScope(req.user);
    if (scope && q.warehouseId && !inScope(scope, q.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    const rows = await svc.listLocations(req.user.companyId, { ...q, ...(scope && { warehouseIds: scope }) });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    fail(res, err);
  }
};

/** GET /api/locations/bins?inventoryId | locationId — bin occupancy rows. */
exports.bins = async (req, res) => {
  try {
    const filter = { companyId: req.user.companyId };
    if (req.query.inventoryId) filter.inventoryId = req.query.inventoryId;
    if (req.query.locationId) filter.locationId = req.query.locationId;
    const rows = await InventoryBin.find(filter)
      .populate("locationId", "fullCode type")
      .sort({ updatedAt: -1 });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    fail(res, err);
  }
};

/** POST /api/locations */
exports.create = async (req, res) => {
  try {
    const loc = await svc.createLocation(req.user.companyId, req.body);
    await audit.log({ req, action: "location.created", entityType: "Location", entityId: loc._id, after: { fullCode: loc.fullCode, type: loc.type } });
    res.status(201).json({ success: true, message: "Location created", data: loc });
  } catch (err) {
    fail(res, err);
  }
};

/** POST /api/locations/generate */
exports.generate = async (req, res) => {
  try {
    const result = await svc.generateTree(req.user.companyId, req.body);
    await audit.log({ req, action: "location.generated", entityType: "Warehouse", entityId: req.body.warehouseId, after: result });
    res.status(201).json({ success: true, message: `Created ${result.created} locations`, data: result });
  } catch (err) {
    fail(res, err);
  }
};

/** POST /api/locations/move */
exports.move = async (req, res) => {
  try {
    const result = await svc.moveBinStock({ companyId: req.user.companyId, performedBy: req.user.id, ...req.body });
    res.json({ success: true, message: "Stock moved", data: result });
  } catch (err) {
    fail(res, err);
  }
};
