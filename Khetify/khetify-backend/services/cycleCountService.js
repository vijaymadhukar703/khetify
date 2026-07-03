const CycleCount = require("../model/Inventory/CycleCount");
const Inventory = require("../model/Inventory/Inventory");
const InventoryBin = require("../model/Inventory/InventoryBin");
const Location = require("../model/Warehouse/Location");
const Warehouse = require("../model/Warehouse/Warehouse");
const Product = require("../model/Company/productModel");
const { nextSeq } = require("./counterService");
const adjustmentService = require("./adjustmentService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function nextCountNumber(companyId) {
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const seq = await nextSeq(companyId, `cc-${period}`);
  return `CC-${period}-${String(seq).padStart(4, "0")}`;
}

/**
 * Generate a count: snapshot the physical system qty (online+offline) of every
 * inventory row in scope. type "full_audit" ignores scope and covers the whole
 * warehouse; freeze is only honoured for a full audit.
 */
async function generateCount(companyId, { warehouseId, scope = {}, type = "cycle", freeze = false, createdBy } = {}) {
  const wh = await Warehouse.findOne({ _id: warehouseId, companyId });
  if (!wh) throw httpErr("Warehouse not found", 404);

  const isFull = type === "full_audit";
  const filter = { ownerId: companyId, ownerType: "company", warehouseId };

  if (!isFull) {
    if (scope.abcClass) filter.abcClass = scope.abcClass;
    if (scope.category) {
      const ids = await Product.find({ companyId, category: scope.category }).distinct("_id");
      filter.productId = { $in: ids };
    }
    if (scope.zoneId) {
      // inventory rows that have stock in any bin under the zone
      const binIds = await Location.find({ companyId, warehouseId, type: "bin" }).distinct("_id");
      // (zone descendant resolution is simplified: any bin whose fullCode starts with the zone code)
      const zone = await Location.findOne({ _id: scope.zoneId, companyId });
      let zoneBinIds = binIds;
      if (zone) {
        const zoneBins = await Location.find({ companyId, warehouseId, type: "bin", fullCode: new RegExp(`^${zone.fullCode}-`) }).distinct("_id");
        zoneBinIds = zoneBins;
      }
      const invIds = await InventoryBin.find({ locationId: { $in: zoneBinIds }, qty: { $gt: 0 } }).distinct("inventoryId");
      filter._id = { $in: invIds };
    }
  }

  const rows = await Inventory.find(filter);
  const lines = rows
    .map((r) => ({
      inventoryId: r._id,
      productId: r.productId,
      locationId: null,
      systemQty: (r.onlineStock || 0) + (r.offlineStock || 0),
      countedQty: null,
    }))
    .filter((l) => l.systemQty > 0 || isFull); // full audit lists empties too

  if (!lines.length) throw httpErr("No stock in scope to count", 400);

  const countNumber = await nextCountNumber(companyId);
  return CycleCount.create({
    companyId,
    countNumber,
    warehouseId,
    type,
    freeze: isFull ? !!freeze : false,
    scope: { zoneId: scope.zoneId || null, category: scope.category || null, abcClass: scope.abcClass || null },
    status: "open",
    lines,
    createdBy,
  });
}

/** Record counted quantities (by line index). Moves status to "counting". */
async function submitCount(companyId, countId, { lines = [], countedBy } = {}) {
  const cc = await CycleCount.findOne({ _id: countId, companyId });
  if (!cc) throw httpErr("Count not found", 404);
  if (["completed", "cancelled"].includes(cc.status)) throw httpErr(`Count is ${cc.status}`, 409);

  for (const patch of lines) {
    const line = cc.lines[patch.index];
    if (!line) continue;
    if (patch.countedQty !== undefined) line.countedQty = Number(patch.countedQty);
    if (patch.recount !== undefined) line.recount = !!patch.recount;
    line.countedBy = countedBy;
  }
  cc.status = "counting";
  await cc.save();
  return cc;
}

/**
 * Finalize a count: for every counted line whose countedQty differs from the
 * snapshot, create ONE pending Adjustment (count_variance). Stock is NOT changed
 * here — a manager approves the adjustments, which applies the deltas. Completing
 * also lifts any audit freeze (status leaves open/counting).
 */
async function completeCount(companyId, countId, { performedBy } = {}) {
  const cc = await CycleCount.findOne({ _id: countId, companyId });
  if (!cc) throw httpErr("Count not found", 404);
  if (cc.status === "completed") throw httpErr("Count already completed", 409);

  let created = 0;
  for (const line of cc.lines) {
    if (line.countedQty === null || line.countedQty === undefined) continue;
    const delta = Number(line.countedQty) - Number(line.systemQty);
    if (delta === 0) continue;
    const adj = await adjustmentService.createAdjustment(companyId, {
      inventoryId: line.inventoryId,
      locationId: line.locationId,
      qtyDelta: delta,
      reason: "count_variance",
      note: `${cc.countNumber} variance (system ${line.systemQty} → counted ${line.countedQty})`,
      requestedBy: performedBy,
      source: "cycle_count",
      cycleCountId: cc._id,
    });
    line.varianceAdjustmentId = adj._id;
    created += 1;
  }
  cc.status = "completed";
  cc.completedAt = new Date();
  await cc.save();
  return { count: cc, adjustmentsCreated: created };
}

async function cancelCount(companyId, countId) {
  const cc = await CycleCount.findOneAndUpdate(
    { _id: countId, companyId, status: { $in: ["open", "counting"] } },
    { $set: { status: "cancelled" } },
    { new: true }
  );
  if (!cc) throw httpErr("Count not found or not cancellable", 404);
  return cc;
}

async function listCounts(companyId, { status, warehouseId, warehouseIds } = {}) {
  const filter = { companyId };
  if (status) filter.status = status;
  if (warehouseId) filter.warehouseId = warehouseId;
  // Warehouse-level access control (services/warehouseScope.js).
  else if (Array.isArray(warehouseIds) && warehouseIds.length) filter.warehouseId = { $in: warehouseIds };
  return CycleCount.find(filter).populate("warehouseId", "name code").sort({ createdAt: -1 });
}

async function getCount(companyId, countId) {
  const cc = await CycleCount.findOne({ _id: countId, companyId })
    .populate("warehouseId", "name code")
    .populate("lines.productId", "productName skuNumber")
    .populate("lines.inventoryId", "lotNumber batchNumber");
  if (!cc) throw httpErr("Count not found", 404);
  return cc;
}

module.exports = { generateCount, submitCount, completeCount, cancelCount, listCounts, getCount };
