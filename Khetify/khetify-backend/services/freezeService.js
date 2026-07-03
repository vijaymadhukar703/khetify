const CycleCount = require("../model/Inventory/CycleCount");

/**
 * Returns the set (as a Set of stringified ids) of warehouses currently under
 * an open audit freeze for a company. A warehouse is frozen when a CycleCount
 * with freeze:true is in status open/counting.
 */
async function frozenWarehouseIds(companyId, session) {
  const rows = await CycleCount.find(
    { companyId, freeze: true, status: { $in: ["open", "counting"] } },
    { warehouseId: 1 }
  ).session(session || null);
  return new Set(rows.map((r) => String(r.warehouseId)));
}

/**
 * Throw 409 if `warehouseId` is under an audit freeze. Used to guard outward
 * stock operations (sale, transfer-out, dispatch).
 */
async function assertNotFrozen(companyId, warehouseId, session) {
  if (!warehouseId) return;
  const frozen = await frozenWarehouseIds(companyId, session);
  if (frozen.has(String(warehouseId))) {
    const err = new Error("Warehouse is under an audit freeze — outward stock operations are blocked until the audit completes");
    err.status = 409;
    throw err;
  }
}

module.exports = { frozenWarehouseIds, assertNotFrozen };
