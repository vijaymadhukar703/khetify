const mongoose = require("mongoose");
const Warehouse = require("../../model/Warehouse/Warehouse");
const Inventory = require("../../model/Inventory/Inventory");
const { assertSellerWarehouse } = require("../../services/warehouseOwnershipService");
const { warehouseScope, inScope } = require("../../services/warehouseScope");

/**
 * Aggregate the seller's owner-scoped inventory grouped by warehouse:
 *   usedUnits = Σ(onlineStock + offlineStock) — physical on-hand occupancy
 *   lotCount  = number of lots (rows) currently holding stock
 * Owner-scoped strictly to { ownerType:"seller", ownerId }. Returns a Map keyed
 * by warehouseId string. Pass a warehouseId to scope to one warehouse.
 */
async function stockByWarehouse(sellerId, warehouseId) {
  const match = { ownerType: "seller", ownerId: new mongoose.Types.ObjectId(String(sellerId)) };
  if (warehouseId) match.warehouseId = new mongoose.Types.ObjectId(String(warehouseId));
  const rows = await Inventory.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$warehouseId",
        usedUnits: { $sum: { $add: ["$onlineStock", "$offlineStock"] } },
        lotCount: { $sum: { $cond: [{ $gt: [{ $add: ["$onlineStock", "$offlineStock"] }, 0] }, 1, 0] } },
      },
    },
  ]);
  const map = new Map();
  rows.forEach((r) => map.set(String(r._id), { usedUnits: r.usedUnits || 0, lotCount: r.lotCount || 0 }));
  return map;
}

/**
 * Seller-owned warehouses. Mirrors the company warehouse handlers
 * (controller/Warehouse/warehouseController.js) but scopes every query by
 * req.user.sellerId instead of companyId. A seller can only ever see/touch
 * warehouses they own (sellerId), never a company's or another seller's.
 *
 * Routes are guarded by authMiddleware + requireApprovedSeller, so only an
 * APPROVED seller principal reaches these handlers.
 */

/** Fields a seller may set on a warehouse (everything else is server-controlled). */
function pickWarehouseFields(body = {}) {
  const out = {};
  if (body.name !== undefined) out.name = body.name;
  if (body.code !== undefined) out.code = body.code;
  if (body.capacityUnits !== undefined) out.capacityUnits = body.capacityUnits;
  if (body.geofenceRadiusM !== undefined) out.geofenceRadiusM = body.geofenceRadiusM;
  if (body.location !== undefined) out.location = body.location;
  if (body.address !== undefined) {
    const a = body.address || {};
    out.address = {
      line1: a.line1,
      city: a.city,
      district: a.district,
      state: a.state,
      pincode: a.pincode,
    };
  }
  return out;
}

/** GET /api/seller/warehouses — the authenticated seller's warehouses, each
 * enriched with its real owner-scoped fill (usedUnits/lotCount) so cards show
 * occupancy without an extra call. */
exports.getSellerWarehouses = async (req, res) => {
  try {
    // Warehouse-level scoping: a seller_manager (or any non-"*" seller role with
    // assigned warehouseIds) sees ONLY their warehouse(s); seller_admin sees all.
    const scope = await warehouseScope(req.user);
    const filter = { sellerId: req.user.sellerId };
    if (scope) filter._id = { $in: scope };
    const rows = await Warehouse.find(filter).sort({ createdAt: -1 });
    const fill = await stockByWarehouse(req.user.sellerId);
    const data = rows.map((w) => {
      const s = fill.get(String(w._id)) || { usedUnits: 0, lotCount: 0 };
      const usedPct = w.capacityUnits ? Math.min(100, Math.round((s.usedUnits / w.capacityUnits) * 100)) : null;
      return { ...w.toObject(), usedUnits: s.usedUnits, lotCount: s.lotCount, usedPct };
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/seller/warehouses/:id/stock-summary — aggregate fill for ONE owned
 * warehouse (free Warehouses module; lot-level detail is the paid Inventory
 * module). Strictly owner-scoped. */
exports.getSellerWarehouseStockSummary = async (req, res) => {
  try {
    await assertSellerWarehouse(req.user.sellerId, req.params.id); // 403/404 if not owned
    // A scoped manager may only read summaries for their assigned warehouse(s).
    const scope = await warehouseScope(req.user);
    if (!inScope(scope, req.params.id)) {
      return res.status(403).json({ success: false, message: "This warehouse isn't assigned to you" });
    }
    const wh = await Warehouse.findOne({ _id: req.params.id, sellerId: req.user.sellerId }).select("capacityUnits name");
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });
    const fill = (await stockByWarehouse(req.user.sellerId, req.params.id)).get(String(req.params.id)) || { usedUnits: 0, lotCount: 0 };
    const capacity = wh.capacityUnits || null;
    const usedPct = capacity ? Math.min(100, Math.round((fill.usedUnits / capacity) * 100)) : null;
    res.json({ success: true, data: { warehouseId: String(wh._id), totalUnits: fill.usedUnits, usedUnits: fill.usedUnits, lotCount: fill.lotCount, capacity, usedPct } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** POST /api/seller/warehouses — create one owned by this seller. */
exports.createSellerWarehouse = async (req, res) => {
  try {
    const fields = pickWarehouseFields(req.body);
    if (!fields.name) return res.status(400).json({ success: false, message: "name is required" });

    const wh = await Warehouse.create({ sellerId: req.user.sellerId, ...fields });
    res.status(201).json({ success: true, message: "Warehouse created", data: wh });
  } catch (err) {
    console.error("createSellerWarehouse error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** PUT /api/seller/warehouses/:id — edit, only if owned by this seller. */
exports.updateSellerWarehouse = async (req, res) => {
  try {
    const wh = await Warehouse.findOne({ _id: req.params.id, sellerId: req.user.sellerId });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });

    const fields = pickWarehouseFields(req.body);
    Object.assign(wh, fields);
    await wh.save();
    res.json({ success: true, message: "Warehouse updated", data: wh });
  } catch (err) {
    console.error("updateSellerWarehouse error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** PATCH /api/seller/warehouses/:id/deactivate — soft-disable, only if owned. */
exports.deactivateSellerWarehouse = async (req, res) => {
  try {
    const wh = await Warehouse.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.user.sellerId },
      { $set: { isActive: false } },
      { new: true }
    );
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });
    res.json({ success: true, message: "Warehouse deactivated", data: { _id: wh._id, isActive: wh.isActive } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Ownership guard lives in services/warehouseOwnershipService.js (shared with
// the lot service's supplyTransfer). Re-exported here for backwards compatibility.
exports.assertSellerWarehouse = assertSellerWarehouse;
