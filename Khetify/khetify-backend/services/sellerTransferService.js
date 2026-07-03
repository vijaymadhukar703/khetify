const TransferRequest = require("../model/Transport/TransferRequest");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const shipmentService = require("./shipmentService");

/** Throw a tagged http error. */
function httpErr(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const POPULATE = [
  { path: "productId", select: "productName skuNumber" },
  { path: "fromWarehouseId", select: "name code" },
  { path: "toWarehouseId", select: "name code" },
];
const ownerFilter = (sellerId) => ({ ownerType: "seller", ownerId: sellerId });

/**
 * Seller inter-warehouse transfers — the owner-aware mirror of the company
 * transfer flow (TransferRequest + shipmentService), scoped to the seller. The
 * lifecycle is request → accept (FEFO-pick + planned Shipment) → dispatch
 * (in_transit) → scan-receive (lands in B, ledger transfer_out/in, request
 * fulfilled). `scope` (warehouse-id array) limits a seller_manager to their
 * assigned warehouse(s); seller_admin (scope = null) is unscoped.
 */
async function listRequests(sellerId, scope, status) {
  const filter = { ...ownerFilter(sellerId) };
  if (status) filter.status = status;
  if (Array.isArray(scope) && scope.length) {
    filter.$or = [{ fromWarehouseId: { $in: scope } }, { toWarehouseId: { $in: scope } }];
  }
  return TransferRequest.find(filter).populate(POPULATE).sort({ createdAt: -1 }).limit(300);
}

/**
 * Create a transfer REQUEST (no stock moves yet). Stock always flows
 * fromWarehouseId (holder/source) → toWarehouseId (receiver). `mode` decides who
 * may INITIATE under warehouse scoping:
 *   push — the SOURCE initiates ("I send my stock") → must own fromWarehouseId.
 *   pull — the DESTINATION initiates ("I ask for stock") → must own toWarehouseId.
 */
async function createRequest({ sellerId, fromWarehouseId, toWarehouseId, productId, qty, note, requestedBy, scope, mode = "push" }) {
  qty = Number(qty);
  if (!["push", "pull"].includes(mode)) throw httpErr(400, "mode must be 'push' or 'pull'");
  if (!fromWarehouseId || !toWarehouseId || !productId || !qty || qty <= 0) {
    throw httpErr(400, "fromWarehouseId, toWarehouseId, productId and a positive qty are required");
  }
  if (String(fromWarehouseId) === String(toWarehouseId)) throw httpErr(400, "Source and destination must differ");

  const [fromOk, toOk] = await Promise.all([
    Warehouse.findOne({ _id: fromWarehouseId, sellerId }).select("name"),
    Warehouse.findOne({ _id: toWarehouseId, sellerId }).select("name"),
  ]);
  if (!fromOk || !toOk) throw httpErr(400, "Both warehouses must be your own");

  // The initiator's own warehouse: source for a push, destination for a pull.
  if (Array.isArray(scope) && scope.length) {
    const ownWh = mode === "pull" ? toWarehouseId : fromWarehouseId;
    if (!scope.map(String).includes(String(ownWh))) {
      throw httpErr(403, mode === "pull"
        ? "You can only request stock INTO your assigned warehouse(s)"
        : "You can only move stock OUT of your assigned warehouse(s)");
    }
  }

  const doc = await TransferRequest.create({
    ...ownerFilter(sellerId), mode, productId, fromWarehouseId, toWarehouseId, qty, note, requestedBy,
  });
  return { doc: await TransferRequest.findById(doc._id).populate(POPULATE), fromName: fromOk.name, toName: toOk.name };
}

/**
 * Load a pending request, scope-checked. The ACCEPTOR is whoever holds the
 * stock being moved — and it must NOT be the initiator:
 *   push — the SOURCE initiated, so the DESTINATION (toWarehouseId) decides.
 *   pull — the DESTINATION initiated, so the HOLDER/SOURCE (fromWarehouseId)
 *          decides (it owns the stock being asked for).
 * seller_admin (no scope) decides either way.
 */
async function loadPending(sellerId, id, scope) {
  const doc = await TransferRequest.findOne({ _id: id, ...ownerFilter(sellerId) });
  if (!doc) throw httpErr(404, "Request not found");
  if (doc.status !== "requested") throw httpErr(409, `Request already ${doc.status}`);
  const deciderWh = doc.mode === "pull" ? doc.fromWarehouseId : doc.toWarehouseId;
  if (Array.isArray(scope) && scope.length && !scope.map(String).includes(String(deciderWh))) {
    throw httpErr(403, doc.mode === "pull"
      ? "Only the holding warehouse (or the seller admin) can decide this request"
      : "Only the destination warehouse (or the seller admin) can decide this request");
  }
  return doc;
}

/**
 * Accept: verify the source warehouse holds enough (FEFO over the seller's lots
 * in A); if short, 409 with the available qty (request stays pending). If
 * enough, FEFO-pick the lots and create a PLANNED Shipment A→B (owner-aware),
 * link it on the request.
 */
async function acceptRequest({ sellerId, id, performedBy, note, scope }) {
  const doc = await loadPending(sellerId, id, scope);

  const lots = await Inventory.find({
    ...ownerFilter(sellerId), warehouseId: doc.fromWarehouseId, productId: doc.productId,
    batchNumber: { $ne: null }, availableStock: { $gt: 0 },
  }).select("availableStock expiryDate lotNumber");
  lots.sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return 0;
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate - b.expiryDate;
  });
  const available = lots.reduce((s, l) => s + l.availableStock, 0);
  if (available < doc.qty) {
    const err = httpErr(409, `Stock not available — only ${available} of ${doc.qty} unit(s) in the source warehouse. Restock and accept later, or reject.`);
    err.data = { available, requested: doc.qty };
    throw err;
  }

  const lines = [];
  let remaining = doc.qty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.availableStock, remaining);
    lines.push({ inventoryId: lot._id, qty: take });
    remaining -= take;
  }

  const toWh = await Warehouse.findOne({ _id: doc.toWarehouseId, sellerId }).select("name");
  const shipment = await shipmentService.createShipment(
    { ownerType: "seller", ownerId: sellerId },
    {
      refType: "TransferRequest", refId: doc._id, fromWarehouseId: doc.fromWarehouseId,
      toType: "warehouse", toWarehouseId: doc.toWarehouseId, toOwnerType: "seller", toOwnerId: sellerId,
      toLabel: `${toWh?.name || "Warehouse"} (transfer)`, lines, performedBy,
    }
  );

  doc.status = "accepted";
  doc.decidedBy = performedBy;
  doc.decidedAt = new Date();
  doc.shipmentId = shipment._id;
  if (note) doc.decisionNote = note;
  await doc.save();
  return { doc: await TransferRequest.findById(doc._id).populate(POPULATE), shipment, lineCount: lines.length };
}

async function rejectRequest({ sellerId, id, note, performedBy, scope }) {
  const doc = await loadPending(sellerId, id, scope);
  doc.status = "rejected";
  doc.decidedBy = performedBy;
  doc.decidedAt = new Date();
  if (note) doc.decisionNote = note;
  await doc.save();
  return TransferRequest.findById(doc._id).populate(POPULATE);
}

module.exports = { listRequests, createRequest, acceptRequest, rejectRequest };
