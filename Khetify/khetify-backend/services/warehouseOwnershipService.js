const Warehouse = require("../model/Warehouse/Warehouse");

/**
 * Ownership guard for seller stock operations: throws (403) if `warehouseId`
 * isn't owned by `sellerId`, so a seller can never receive/move stock into a
 * company warehouse or another seller's. Returns the warehouse doc on success.
 *
 * Lives in services/ so both the seller warehouse controller and the lot
 * service (supplyTransfer) can use it without a service→controller dependency.
 */
async function assertSellerWarehouse(sellerId, warehouseId) {
  const wh = await Warehouse.findOne({ _id: warehouseId, sellerId });
  if (!wh) {
    const err = new Error("Warehouse not found for this seller");
    err.status = 403;
    throw err;
  }
  return wh;
}

/**
 * Ownership guard for company-source operations (e.g. the supply source
 * warehouse a company assigns at approval): throws if the warehouse isn't owned
 * by that company. Returns the warehouse doc on success.
 */
async function assertCompanyWarehouse(companyId, warehouseId) {
  const wh = await Warehouse.findOne({ _id: warehouseId, companyId });
  if (!wh) {
    const err = new Error("Source warehouse not found for this company");
    err.status = 400;
    throw err;
  }
  return wh;
}

module.exports = { assertSellerWarehouse, assertCompanyWarehouse };
