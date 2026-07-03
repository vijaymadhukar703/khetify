const mongoose = require("mongoose");
const Inventory = require("../model/Inventory/Inventory");
const Warehouse = require("../model/Warehouse/Warehouse");

function httpErr(message, status = 409) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Live occupancy of a warehouse: the sum of availableStock across every lot
 * stored in it for one owner. This is the SAME number the UI shows ("occupancy
 * computed from live lots"), so the cap and the display never disagree.
 *
 * `excludeInventoryId` drops one lot row from the sum — used when re-setting a
 * lot's quantity so its own current value isn't double-counted against the cap.
 */
async function warehouseOccupancy({ ownerType = "company", ownerId, warehouseId, session = null, excludeInventoryId = null }) {
  if (!warehouseId) return 0;
  const match = {
    ownerType,
    ownerId: new mongoose.Types.ObjectId(String(ownerId)),
    warehouseId: new mongoose.Types.ObjectId(String(warehouseId)),
  };
  if (excludeInventoryId) match._id = { $ne: new mongoose.Types.ObjectId(String(excludeInventoryId)) };
  const agg = await Inventory.aggregate([
    { $match: match },
    { $group: { _id: null, units: { $sum: "$availableStock" } } },
  ]).session(session);
  return Number(agg?.[0]?.units) || 0;
}

/**
 * Throw 409 if adding `addQty` sellable units to `warehouseId` would push its
 * live occupancy past the warehouse's capacityUnits. Warehouses with no
 * capacity set (or 0) are treated as uncapped and skipped — non-breaking for
 * existing warehouses that never had a capacity.
 *
 * Runs inside the caller's transaction when a `session` is passed, so the
 * occupancy read reflects earlier stock-in lines committed in the same txn
 * (e.g. multi-line GRN posting) and the cap holds cumulatively.
 */
async function assertWarehouseCapacity({ ownerType = "company", ownerId, warehouseId, addQty, session = null, excludeInventoryId = null }) {
  addQty = Number(addQty) || 0;
  if (!warehouseId || addQty <= 0) return;
  const wh = await Warehouse.findById(warehouseId).select("capacityUnits name").session(session);
  const capacity = wh ? Number(wh.capacityUnits) : NaN;
  if (!Number.isFinite(capacity) || capacity <= 0) return; // uncapped
  const current = await warehouseOccupancy({ ownerType, ownerId, warehouseId, session, excludeInventoryId });
  if (current + addQty > capacity) {
    const room = Math.max(0, capacity - current);
    const message = room > 0
      ? `Cannot add stock. Only ${room} units space is available in this warehouse.`
      : `Cannot add stock. Warehouse capacity is full. Available space is 0 units.`;
    throw httpErr(message, 409);
  }
}

module.exports = { warehouseOccupancy, assertWarehouseCapacity };
