const Adjustment = require("../model/Inventory/Adjustment");
const Inventory = require("../model/Inventory/Inventory");
const InventoryBin = require("../model/Inventory/InventoryBin");
const StockMovement = require("../model/Inventory/StockMovement");
const { withTransaction } = require("./txn");
const { nextSeq } = require("./counterService");
const { assertWarehouseCapacity } = require("./warehouseCapacityService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function nextAdjustmentNumber(companyId, session) {
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const seq = await nextSeq(companyId, `adj-${period}`, session);
  return `ADJ-${period}-${String(seq).padStart(4, "0")}`;
}

/**
 * Create a PENDING adjustment (no stock change yet). Used by the manual flow
 * and by cycle-count completion (one per variance line).
 */
async function createAdjustment(companyId, { inventoryId, locationId = null, qtyDelta, reason, note, requestedBy, source = "manual", cycleCountId = null, session }) {
  qtyDelta = Number(qtyDelta);
  if (!inventoryId || !qtyDelta || Number.isNaN(qtyDelta)) throw httpErr("inventoryId and a non-zero qtyDelta are required");
  if (!reason) throw httpErr("reason is required");

  const inv = await Inventory.findOne({ _id: inventoryId, ownerId: companyId, ownerType: "company" }).session(session || null);
  if (!inv) throw httpErr("Inventory row not found", 404);

  const adjustmentNumber = await nextAdjustmentNumber(companyId, session);
  const [adj] = await Adjustment.create(
    [{ companyId, adjustmentNumber, inventoryId, locationId, qtyDelta, reason, note, requestedBy, source, cycleCountId, status: "pending" }],
    session ? { session } : {}
  );
  return adj;
}

/** Apply an approved adjustment's delta to stock (and bin), with a ledger row. */
async function applyInTxn(session, adj) {
  const delta = adj.qtyDelta;
  const filter = { _id: adj.inventoryId, ownerId: adj.companyId, ownerType: "company" };
  if (delta < 0) {
    // guard against driving physical stock negative
    filter.offlineStock = { $gte: -delta };
    filter.availableStock = { $gte: -delta };
  } else if (delta > 0) {
    // Increasing a lot's quantity must respect the warehouse capacity too.
    const row = await Inventory.findById(adj.inventoryId).select("warehouseId").session(session || null);
    if (row) {
      await assertWarehouseCapacity({ ownerType: "company", ownerId: adj.companyId, warehouseId: row.warehouseId, addQty: delta, session });
    }
  }
  const inv = await Inventory.findOneAndUpdate(
    filter,
    { $inc: { offlineStock: delta, availableStock: delta } },
    { new: true, session }
  );
  if (!inv) throw httpErr("Cannot apply adjustment — would drive stock negative", 409);

  if (adj.locationId) {
    const binFilter = { inventoryId: adj.inventoryId, locationId: adj.locationId };
    if (delta < 0) binFilter.qty = { $gte: -delta };
    const bin = await InventoryBin.findOneAndUpdate(
      binFilter,
      { $inc: { qty: delta }, $setOnInsert: { companyId: adj.companyId } },
      { new: true, upsert: delta > 0, session }
    );
    if (!bin && delta < 0) throw httpErr("Cannot apply adjustment — bin does not hold enough stock", 409);
  }

  await StockMovement.create(
    [{
      inventoryId: inv._id,
      productId: inv.productId,
      ownerType: "company",
      ownerId: adj.companyId,
      type: "adjustment",
      channel: "internal",
      quantity: delta,
      balanceAfter: inv.availableStock,
      refType: "Adjustment",
      refId: adj._id,
      performedBy: adj.approvedBy,
      note: `${adj.reason}${adj.note ? ` — ${adj.note}` : ""}`,
    }],
    { session }
  );
  return inv;
}

/**
 * Approve and apply. The approver must differ from the requester
 * (segregation of duties).
 */
async function approveAdjustment(companyId, adjId, { approverId }) {
  const adj = await Adjustment.findOne({ _id: adjId, companyId });
  if (!adj) throw httpErr("Adjustment not found", 404);
  if (adj.status !== "pending") throw httpErr(`Adjustment is already ${adj.status}`, 409);
  if (adj.requestedBy && approverId && String(adj.requestedBy) === String(approverId)) {
    throw httpErr("You cannot approve your own adjustment", 403);
  }

  await withTransaction(async (session) => {
    adj.approvedBy = approverId;
    await applyInTxn(session, adj);
    adj.status = "approved";
    adj.decidedAt = new Date();
    await adj.save({ session });
  });
  return adj;
}

async function rejectAdjustment(companyId, adjId, { approverId }) {
  const adj = await Adjustment.findOne({ _id: adjId, companyId });
  if (!adj) throw httpErr("Adjustment not found", 404);
  if (adj.status !== "pending") throw httpErr(`Adjustment is already ${adj.status}`, 409);
  adj.status = "rejected";
  adj.approvedBy = approverId;
  adj.decidedAt = new Date();
  await adj.save();
  return adj;
}

async function listAdjustments(companyId, { status } = {}) {
  const filter = { companyId };
  if (status) filter.status = status;
  return Adjustment.find(filter)
    .populate("inventoryId", "lotNumber batchNumber productId")
    .populate("locationId", "fullCode")
    .sort({ createdAt: -1 });
}

module.exports = { createAdjustment, approveAdjustment, rejectAdjustment, listAdjustments, nextAdjustmentNumber };
