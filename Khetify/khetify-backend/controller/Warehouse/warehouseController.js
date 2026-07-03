const Warehouse = require("../../model/Warehouse/Warehouse");
const { warehouseScope } = require("../../services/warehouseScope");

/** GET /api/warehouse */
exports.getWarehouses = async (req, res) => {
  try {
    // DIRECTORY MODE (?directory=1): every company warehouse, names only.
    // Needed by transfer/shipment destination pickers — a scoped operations
    // manager must be able to SEND to any company warehouse even though their
    // data visibility is restricted to their own. No capacity/geofence/stock
    // details are exposed here.
    if (req.query.directory) {
      const rows = await Warehouse.find({ companyId: req.user.companyId })
        .select("name code address")
        .sort({ name: 1 });
      return res.json({ success: true, count: rows.length, data: rows });
    }

    // Warehouse-level access: scoped users (e.g. an operations manager
    // assigned to Khargone) only see their assigned warehouses.
    const scope = await warehouseScope(req.user);
    const filter = { companyId: req.user.companyId };
    if (scope) filter._id = { $in: scope };
    const rows = await Warehouse.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST /api/warehouse  (premium: multi_warehouse + enforceLimit) */
exports.createWarehouse = async (req, res) => {
  try {
    const { name, code, address, location, capacityUnits } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "name is required" });

    const wh = await Warehouse.create({
      companyId: req.user.companyId,
      name,
      code,
      address,
      location,
      capacityUnits,
    });
    res.status(201).json({ success: true, message: "Warehouse created", data: wh });
  } catch (err) {
    console.error("createWarehouse error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** PUT /api/warehouse/:id — edit an existing company warehouse. */
exports.updateWarehouse = async (req, res) => {
  try {
    // Scope by companyId so a company can only edit its OWN warehouses.
    const wh = await Warehouse.findOne({
      _id: req.params.id,
      companyId: req.user.companyId,
    });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });

    const { name, code, address, capacityUnits } = req.body;
    if (name !== undefined) {
      if (!name) return res.status(400).json({ success: false, message: "name is required" });
      wh.name = name;
    }
    if (code !== undefined) wh.code = code;
    if (capacityUnits !== undefined) {
      wh.capacityUnits = capacityUnits === "" || capacityUnits === null ? undefined : capacityUnits;
    }
    if (address && typeof address === "object") {
      if (!wh.address) wh.address = {};
      for (const k of ["line1", "city", "district", "state", "pincode"]) {
        if (address[k] !== undefined) wh.address[k] = address[k];
      }
      wh.markModified("address");
    }

    await wh.save(); // runs the company-XOR-seller pre('validate') hook
    res.json({ success: true, message: "Warehouse updated", data: wh });
  } catch (err) {
    console.error("updateWarehouse error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/warehouse/nearest?lng=..&lat=.. — nearest active warehouse. */
exports.nearestWarehouse = async (req, res) => {
  try {
    const lng = parseFloat(req.query.lng);
    const lat = parseFloat(req.query.lat);
    if (Number.isNaN(lng) || Number.isNaN(lat)) {
      return res.status(400).json({ success: false, message: "lng and lat are required" });
    }
    const wh = await Warehouse.findOne({
      companyId: req.user.companyId,
      isActive: true,
      location: {
        $near: { $geometry: { type: "Point", coordinates: [lng, lat] } },
      },
    });
    res.json({ success: true, data: wh });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
