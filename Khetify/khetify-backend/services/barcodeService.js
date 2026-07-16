const mongoose = require("mongoose");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const Location = require("../model/Warehouse/Location");
const Order = require("../model/Order/Order");
const InventoryBin = require("../model/Inventory/InventoryBin");
const { nextSeqBlock } = require("./counterService");
const { hasCapability } = require("../config/permissions");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const MAX_GENERATE = 10000;

/**
 * Owner-aware scoping. Accepts EITHER an owner object { ownerType, ownerId }
 * OR a bare companyId (legacy callers → treated as the company owner). This
 * keeps every existing internal caller (pick/pack/dispatch/shipment/pos, which
 * pass companyId) working unchanged, while letting seller callers pass an
 * explicit owner.
 */
function normalizeOwner(owner) {
  if (owner && typeof owner === "object" && owner.ownerType) {
    return { ownerType: owner.ownerType, ownerId: owner.ownerId };
  }
  return { ownerType: "company", ownerId: owner };
}

/* ------------------------------------------------------------- formats */

/** Lot barcode content (Code 128): K-L-<companyShort>-<sku>-<lot>. */
function lotBarcode(companyShort, sku, lot) {
  const c = (companyShort || "CO").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const s = (sku || "GEN").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `K-L-${c}-${s}-${String(lot).toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}

/** Sanitize a lot/batch number for use inside a Code-128 serial. */
function lotKey(lot) {
  return String(lot || "LOT").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Unit serial: <LOTNUMBER>-<seq, 3+ padded>. The visible sequence is the lot
 * number followed by a running number (e.g. lot "UR-2026-JUN-001" →
 * UR2026JUN001-001 … -050). There is NO prefix: serials are stored bare and
 * resolveScan() looks them up directly (tolerating a legacy "K-U-" on labels
 * printed before the prefix was dropped). Sequence is unique per lot (see
 * generateUnits).
 */
function unitSerial(lot, seq) {
  return `${lotKey(lot)}-${String(seq).padStart(3, "0")}`;
}

const qrFor = (serial) => JSON.stringify({ t: "unit", s: serial });

/* ------------------------------------------------------------ generate */

/**
 * Bulk-generate `qty` unit serials for an inventory (lot) row. Each serial is
 * the lot number followed by a running sequence (<LOT>-<NNN>). The counter
 * is keyed on the lot number, so the sequence is continuous and unique across
 * every batch printed for that lot. Reserves a contiguous counter block so
 * serials are unique without per-unit round-trips, then inserts them with
 * status "generated". Marks the product trackSerial.
 */
async function generateUnits(companyId, inventoryId, qty, { performedBy } = {}) {
  // Generation is COMPANY-ONLY — sellers never mint serials (keeps `serial`
  // globally unique and collision-free). Reject a seller owner.
  const owner = normalizeOwner(companyId);
  if (owner.ownerType !== "company") throw httpErr("Sellers cannot generate unit serials", 403);
  companyId = owner.ownerId;

  qty = Number(qty);
  if (!inventoryId || !qty || qty <= 0) throw httpErr("inventoryId and positive qty are required");
  if (qty > MAX_GENERATE) throw httpErr(`Cannot generate more than ${MAX_GENERATE} at once`);

  const inv = await Inventory.findOne({ _id: inventoryId, ownerId: companyId, ownerType: "company" });
  if (!inv) throw httpErr("Inventory row not found", 404);

  // Can't label more units than the lot actually holds: verify against the
  // inventory row's stock, counting serials already generated. In-transit qty
  // (booked to a warehouse but awaiting its receipt) counts toward the cap, so
  // labels can be printed before the warehouse confirms receipt.
  const existing = await UnitSerial.countDocuments({ companyId, inventoryId: inv._id });
  const cap = Number(inv.availableStock || 0) + Number(inv.inTransitStock || 0);
  if (existing + qty > cap) {
    const remaining = Math.max(0, cap - existing);
    throw httpErr(
      `Lot has ${cap} unit(s) in stock${existing ? ` and ${existing} already labelled` : ""} — you can generate at most ${remaining} more.`,
      409
    );
  }

  // ROOT-CAUSE FIX (parent-lot / unit-serial warehouse assignment):
  // When the parent lot (this Inventory row) is ALREADY assigned to a warehouse,
  // its stock is physically on hand there — so serials minted afterwards are
  // AVAILABLE in that warehouse immediately. They are already tied to the
  // warehouse through `inventoryId` (Inventory.warehouseId is the lot's
  // warehouse), so we do NOT add a duplicate warehouse field; we only start them
  // in this model's available/pickable state ("in_stock") instead of "generated"
  // (which would otherwise wait for a putaway that this direct-create flow never
  // performs). Unassigned lots (warehouseId === null) keep the original
  // "generated" flow untouched — no behaviour change for GRN/putaway-less lots.
  //
  // This adds NO stock: serials are tracking records over the lot's EXISTING
  // quantity. The cap check above already prevents ever labelling more units
  // than the lot holds, and re-generate/reprint can't create duplicates.
  // A lot that is still AWAITING the warehouse's Confirm Receive is not stock
  // yet, so its serials must NOT be pickable: they stay "generated" and are
  // activated to "in_stock" by lotService.confirmLotReceipt. Only a lot whose
  // stock is genuinely on the books mints available units.
  const pendingReceipt = Number(inv.inTransitStock || 0) > 0 && Number(inv.availableStock || 0) <= 0;
  const warehoused = !!inv.warehouseId && !pendingReceipt;
  const initialStatus = warehoused ? "in_stock" : "generated";
  const lot = inv.lotNumber || inv.batchNumber || String(inv._id);
  const { start, end } = await nextSeqBlock(companyId, `unit-lot-${lotKey(lot)}`, qty);
  const docs = [];
  for (let seq = start; seq <= end; seq++) {
    const serial = unitSerial(lot, seq);
    docs.push({
      companyId,
      ownerType: "company",
      ownerId: companyId,
      serial,
      qr: qrFor(serial),
      productId: inv.productId,
      inventoryId: inv._id,
      lotNumber: inv.lotNumber,
      batchNumber: inv.batchNumber,
      status: initialStatus,
    });
  }
  await UnitSerial.insertMany(docs, { ordered: false });

  // Trace: record availability at the lot's warehouse for units minted straight
  // into stock (keeps the unit lifecycle coherent for later pick/transfer).
  if (warehoused) {
    await UnitEvent.insertMany(
      docs.map((d) => ({ companyId, serial: d.serial, event: "in_stock", fromStatus: "generated", toStatus: "in_stock", refType: "Lot", refId: inv._id, actorId: performedBy })),
      { ordered: false }
    );
  }

  // Generating serials implies the product is serial-tracked going forward.
  await Product.updateOne({ _id: inv.productId, companyId }, { $set: { trackSerial: true } });

  return { generated: docs.length, firstSerial: docs[0].serial, lastSerial: docs[docs.length - 1].serial, status: initialStatus };
}

/* -------------------------------------------------------------- queries */

async function listUnits(owner, { inventoryId, lotNumber, status, limit = 2000 } = {}) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const filter = { ownerType, ownerId };
  if (inventoryId) filter.inventoryId = inventoryId;
  if (lotNumber) filter.lotNumber = lotNumber;
  if (status) filter.status = status;
  return UnitSerial.find(filter).sort({ serial: 1 }).limit(Math.min(Number(limit) || 2000, 10000));
}

/* --------------------------------------------------------- transitions */

// Allowed forward transitions (and recall/return as special cases).
const NEXT = {
  generated: ["printed", "in_stock", "recalled", "damaged"],
  printed: ["in_stock", "recalled", "damaged"],
  in_stock: ["picked", "recalled", "damaged"],
  picked: ["packed", "in_stock", "recalled"],
  packed: ["shipped", "picked", "recalled"],
  shipped: ["sold", "returned"],
  sold: ["returned"],
  returned: ["in_stock", "damaged"],
  damaged: [],
  recalled: [],
};

/**
 * Transition a set of serials to a new status, writing one UnitEvent each.
 * Skips serials that cannot legally make the transition unless `force`.
 */
async function transitionUnits(owner, serials, { toStatus, event, refType, refId, locationId, actorId, set = {}, force = false } = {}) {
  if (!Array.isArray(serials) || !serials.length) throw httpErr("serials are required");
  // Scope to the CURRENT owner — a seller can only transition units they own,
  // a company only its own. UnitEvent.companyId stays the unit's originating
  // company (immutable trace root), regardless of who now holds it.
  const { ownerType, ownerId } = normalizeOwner(owner);
  const units = await UnitSerial.find({ ownerType, ownerId, serial: { $in: serials } });
  const moved = [];
  const skipped = [];
  const events = [];
  for (const u of units) {
    if (!force && !(NEXT[u.status] || []).includes(toStatus)) {
      skipped.push({ serial: u.serial, from: u.status });
      continue;
    }
    const update = { status: toStatus, ...set };
    if (locationId !== undefined) update.currentLocationId = locationId;
    await UnitSerial.updateOne({ _id: u._id }, { $set: update });
    events.push({
      companyId: u.companyId, serial: u.serial, event: event || toStatus,
      fromStatus: u.status, toStatus, refType, refId, locationId, actorId,
    });
    moved.push(u.serial);
  }
  if (events.length) await UnitEvent.insertMany(events, { ordered: false });
  return { moved, skipped };
}

/**
 * Print / RE-PRINT labels for the owner's units. First print moves a freshly
 * "generated" unit to "printed"; re-printing a unit that's already advanced
 * (printed / in_stock / …) does NOT regress its lifecycle status — it just logs
 * a "printed" event. Owner-scoped, so a seller can only (re)print units it owns.
 */
async function markPrinted(owner, serials, { actorId } = {}) {
  if (!Array.isArray(serials) || !serials.length) throw httpErr("serials are required");
  const { ownerType, ownerId } = normalizeOwner(owner);
  const units = await UnitSerial.find({ ownerType, ownerId, serial: { $in: serials } });
  const moved = [];
  const events = [];
  for (const u of units) {
    // First print of a still-"generated" unit advances it to "printed"; a unit
    // already put away/available ("in_stock", etc.) keeps its stock status but
    // is still flagged printed. The `printed` flag is what the Labels page reads,
    // so it is set here for EVERY unit (independent of the stock status).
    const toStatus = u.status === "generated" ? "printed" : u.status;
    const set = { printed: true, printedAt: new Date() };
    if (u.status === "generated") set.status = "printed";
    await UnitSerial.updateOne({ _id: u._id }, { $set: set });
    events.push({ companyId: u.companyId, serial: u.serial, event: "printed", fromStatus: u.status, toStatus, refType: "Label", actorId });
    moved.push(u.serial);
  }
  if (events.length) await UnitEvent.insertMany(events, { ordered: false });
  return { moved, skipped: [] };
}

async function unitHistory(owner, serial) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  // Serials are globally unique — look up by serial, then authorize: visible to
  // the CURRENT owner OR to the ORIGINATING company (full-chain trace).
  const unit = await UnitSerial.findOne({ serial }).populate("productId", "productName skuNumber").populate("currentLocationId", "fullCode");
  if (!unit) throw httpErr("Serial not found", 404);
  const isCurrentOwner = unit.ownerType === ownerType && String(unit.ownerId) === String(ownerId);
  const isOriginatingCompany = ownerType === "company" && String(unit.companyId) === String(ownerId);
  if (!isCurrentOwner && !isOriginatingCompany) throw httpErr("Serial not found", 404);
  // Events are keyed by serial (no owner) so the FULL chain is returned.
  const events = await UnitEvent.find({ serial }).sort({ at: 1 });
  return { unit, events };
}

/* -------------------------------------------------------------- scan */

function nextActionsFor(type, status, role) {
  const can = (c) => hasCapability(role, c);
  if (type === "unit") {
    const actions = [];
    if (["generated", "printed", "returned"].includes(status) && can("putaway:execute")) actions.push("putaway");
    if (status === "in_stock" && can("order:create")) actions.push("pick");
    if (status === "picked" && can("order:create")) actions.push("pack");
    if (status === "packed" && can("shipment:read")) actions.push("dispatch");
    return actions;
  }
  if (type === "location" && can("location:read")) return ["view_bin"];
  if (type === "lot" && can("lot:read")) return ["view_lot"];
  return [];
}

/**
 * Single scan entry point. Detects unit serial / lot barcode / location code /
 * raw lot number and returns the matched entity plus role-aware next actions.
 */
async function resolveScan(owner, rawCode, role) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const code = String(rawCode || "").trim();
  if (!code) throw httpErr("Empty scan");

  // Lot barcode K-L-<co>-<sku>-<lot> (checked first: it has a dedicated prefix
  // and its embedded lot can otherwise look like a raw lot number). Scoped to
  // the scanner's own inventory.
  if (/^K-L-/i.test(code)) {
    const parts = code.split("-");
    const lot = parts.slice(4).join("-");
    const rows = await Inventory.find({ ownerId, ownerType, $or: [{ lotNumber: lot }, { batchNumber: lot }] }).populate("productId", "productName skuNumber");
    if (!rows.length) throw httpErr("Unknown lot barcode", 404);
    return { type: "lot", lot, rows, nextActions: nextActionsFor("lot", null, role) };
  }

  // Unit serial (prefix-less now; tolerate a legacy "K-U-" on old printed
  // labels). Resolved when the scanner is the CURRENT owner of the unit
  // (serials are globally unique + single-owner, so no ambiguity).
  const unitSerialCode = code.replace(/^K-U-/i, "").toUpperCase();
  const unit = await UnitSerial.findOne({ ownerType, ownerId, serial: unitSerialCode })
    .populate("productId", "productName skuNumber")
    .populate("currentLocationId", "fullCode");
  if (unit) {
    return { type: "unit", unit, nextActions: nextActionsFor("unit", unit.status, role) };
  }

  // Location fullCode (companies only — sellers have no storage locations).
  if (ownerType === "company") {
    const loc = await Location.findOne({ companyId: ownerId, fullCode: code.toUpperCase() });
    if (loc) return { type: "location", location: loc, nextActions: nextActionsFor("location", null, role) };
  }

  // Raw lot / batch number, scoped to the scanner's own inventory.
  const rows = await Inventory.find({ ownerId, ownerType, $or: [{ lotNumber: code }, { batchNumber: code }] }).populate("productId", "productName skuNumber");
  if (rows.length) return { type: "lot", lot: code, rows, nextActions: nextActionsFor("lot", null, role) };

  throw httpErr("Unrecognized code", 404);
}

/* ------------------------------------------------------------- recall */

/**
 * Recall a lot. Marks every not-yet-sold serial "recalled" (blocking it from
 * picking) and returns the full distribution: where stock is held + which
 * orders/customers received units from this lot.
 */
async function recall(companyId, lotNumber, { performedBy } = {}) {
  if (!lotNumber) throw httpErr("lotNumber is required");

  // companyId here is the ORIGINATING company, which never changes when a unit
  // is supplied to a seller — so this query reaches units across ALL current
  // owners (company-held AND seller-held), exactly what a recall must do.
  const units = await UnitSerial.find({ companyId, lotNumber });
  const recallable = units.filter((u) => !["sold", "returned", "recalled"].includes(u.status));
  const soldUnits = units.filter((u) => u.status === "sold");

  // Mark recallable units recalled + event log.
  if (recallable.length) {
    const serials = recallable.map((u) => u.serial);
    await UnitSerial.updateMany({ companyId, serial: { $in: serials } }, { $set: { status: "recalled" } });
    await UnitEvent.insertMany(
      recallable.map((u) => ({ companyId, serial: u.serial, event: "recalled", fromStatus: u.status, toStatus: "recalled", refType: "Recall", actorId: performedBy })),
      { ordered: false }
    );
  }

  // Stock distribution from the quantity ledger (covers non-serialized stock too).
  const invRows = await Inventory.find({ ownerId: companyId, ownerType: "company", $or: [{ lotNumber }, { batchNumber: lotNumber }] }).populate("warehouseId", "name code");
  const invIds = invRows.map((r) => r._id);
  const bins = await InventoryBin.find({ inventoryId: { $in: invIds }, qty: { $gt: 0 } }).populate("locationId", "fullCode");
  const stock = invRows.map((r) => ({
    warehouse: r.warehouseId?.name || "—",
    availableStock: r.availableStock,
    damagedStock: r.damagedStock,
    bins: bins.filter((b) => String(b.inventoryId) === String(r._id)).map((b) => ({ bin: b.locationId?.fullCode, qty: b.qty })),
  }));

  // Customers reached: orders that received serials from this lot.
  const orderIds = [...new Set(units.filter((u) => u.orderId).map((u) => String(u.orderId)))];
  const orders = await Order.find({ _id: { $in: orderIds }, companyId }).select("orderNumber customerName customerId");
  const customers = orders.map((o) => ({ orderId: o._id, orderNumber: o.orderNumber, customerName: o.customerName, customerId: o.customerId }));

  return {
    lotNumber,
    recalledUnits: recallable.length,
    soldUnits: soldUnits.length,
    stock,
    customers,
  };
}

module.exports = {
  lotBarcode,
  unitSerial,
  generateUnits,
  listUnits,
  markPrinted,
  transitionUnits,
  unitHistory,
  resolveScan,
  recall,
  MAX_GENERATE,
};
