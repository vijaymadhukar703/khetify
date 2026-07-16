const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const Warehouse = require("../model/Warehouse/Warehouse");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const { emitInventoryUpdate, checkLowStock } = require("./inventoryService");
const { withTransaction } = require("./txn");
const { frozenWarehouseIds } = require("./freezeService");
const { nextSeq } = require("./counterService");
const { assertSellerWarehouse, assertCompanyWarehouse } = require("./warehouseOwnershipService");
const { assertWarehouseCapacity } = require("./warehouseCapacityService");

/* ---------- lot numbering ---------- */

/** Resolve a warehouse's 3-letter code (uppercased), or "GEN". */
async function warehouseCode3(companyId, warehouseId) {
  if (!warehouseId) return "GEN";
  const wh = await Warehouse.findOne({ _id: warehouseId, companyId }).select("code name");
  const base = (wh?.code || wh?.name || "GEN").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return base ? base.slice(0, 3).padEnd(3, "X") : "GEN";
}

/**
 * Auto lot number used when the operator doesn't type one when creating a lot.
 * Always the Khetify-generated number (KH-<WH>-<YYYYMM>-<seq>); the numbering
 * choice is made per-lot in the UI, not as a company-wide setting.
 */
async function autoLotNumber(companyId, warehouseId, session) {
  return generateKhetifyLotNumber(companyId, warehouseId, session);
}

/**
 * Khetify-generated lot number: KH-<WH3>-<YYYYMM>-<seq4>,
 * e.g. KH-KHA-202606-0001 (Khargone, June 2026, first lot of the month).
 * Sequence is per (company, warehouse, month) via the atomic Counter.
 */
async function generateKhetifyLotNumber(companyId, warehouseId, session) {
  const wh3 = await warehouseCode3(companyId, warehouseId);
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const seq = await nextSeq(companyId, `kh-lot-${wh3}-${period}`, session);
  return `KH-${wh3}-${period}-${String(seq).padStart(4, "0")}`;
}

/* Ledger writer (same shape inventoryService uses internally).
 * Pass `session` to enlist the write in an active transaction. */
async function ledger(
  inv,
  { type, channel = "internal", quantity, refType, refId, performedBy, note, session }
) {
  await StockMovement.create(
    [
      {
        inventoryId: inv._id,
        productId: inv.productId,
        ownerType: inv.ownerType,
        ownerId: inv.ownerId,
        type,
        channel,
        quantity,
        balanceAfter: inv.availableStock,
        refType,
        refId,
        performedBy,
        note,
      },
    ],
    session ? { session } : {}
  );
}

const POPULATE_PRODUCT = {
  path: "productId",
  select:
    "productName category unitType unit packagingType mrp brandName skuNumber hsnCode productImages companyId",
  populate: { path: "companyId", select: "companyName" },
};

/* ---------- queries ---------- */

/**
 * All lot rows (batchNumber != null) for an owner, joined with product +
 * warehouse. Owner-aware: defaults to ownerType "company" so the existing
 * company caller is unchanged; sellers pass ownerType "seller".
 */
async function getLots(ownerId, { ownerType = "company", productId, warehouseId, warehouseIds, expiring, expired, excludePending = false } = {}) {
  const filter = {
    ownerType,
    ownerId,
    batchNumber: { $ne: null },
  };
  // A warehouse must not see (or count) stock it hasn't received yet: hide rows
  // that are purely awaiting receipt (nothing on the books, qty still in
  // transit). A row with some received stock AND more incoming still shows.
  if (excludePending) {
    filter.$nor = [{ inTransitStock: { $gt: 0 }, availableStock: { $lte: 0 } }];
  }
  if (productId) filter.productId = productId;
  if (warehouseId) filter.warehouseId = warehouseId;
  // Warehouse-level access control: restrict to the caller's assigned
  // warehouses (services/warehouseScope.js). Combined with `warehouseId`
  // above via implicit AND, so a scoped user can't widen their view.
  else if (Array.isArray(warehouseIds) && warehouseIds.length) filter.warehouseId = { $in: warehouseIds };

  const now = new Date();
  if (expiring === "true") {
    const horizon = new Date(now.getTime() + 90 * 86400000);
    filter.expiryDate = { $gte: now, $lte: horizon };
    filter.availableStock = { $gt: 0 };
  }
  if (expired === "true") {
    filter.expiryDate = { $lt: now };
    filter.availableStock = { $gt: 0 };
  }

  // Expiry-focused views surface what expires soonest; the default list shows
  // the most recently created lot on top. (Stock rotation FEFO is handled
  // separately in sellFEFO/allocateFEFO and is unaffected.)
  const sort = (expiring === "true" || expired === "true")
    ? { expiryDate: 1 }            // expiry views: soonest-expiring first
    : { createdAt: -1, _id: -1 };  // default: newest lot on top
  return Inventory.find(filter)
    .populate(POPULATE_PRODUCT)
    .populate("warehouseId", "name code address")
    .sort(sort);
}

/* ---------- Company Warehouse: pending receipt ---------- */

/**
 * Find the lot AWAITING RECEIPT at this warehouse, by EXACT parent lot number.
 * Read-only — moves nothing. Normalisation is trim + uppercase only; the lot
 * number is matched verbatim (never partial/prefix).
 */
async function findPendingLot(companyId, { lotNumber, allowedWarehouseIds = null }) {
  const lot = String(lotNumber || "").trim().toUpperCase();
  if (!lot) throw httpErr("Lot not found.", 404);

  const rows = await Inventory.find({
    ownerType: "company", ownerId: companyId,
    $or: [{ lotNumber: lot }, { batchNumber: lot }],
  })
    .populate("productId", "productName skuNumber")
    .populate("warehouseId", "name code");
  if (!rows.length) throw httpErr("Lot not found.", 404);

  const pending = rows.filter((r) => (r.inTransitStock || 0) > 0);
  if (!pending.length) {
    // The lot exists but nothing is awaiting receipt for it.
    const mineReceived = rows.some((r) =>
      !Array.isArray(allowedWarehouseIds) ||
      allowedWarehouseIds.map(String).includes(String(r.warehouseId?._id || r.warehouseId))
    );
    throw httpErr(mineReceived ? "This transfer has already been received." : "No incoming transfer found for this lot.", 409);
  }

  const mine = Array.isArray(allowedWarehouseIds)
    ? pending.filter((r) => allowedWarehouseIds.map(String).includes(String(r.warehouseId?._id || r.warehouseId)))
    : pending;
  if (!mine.length) throw httpErr("This lot is not assigned to your warehouse.", 403);

  const row = mine[0];
  return {
    inventoryId: row._id,
    lotNumber: row.lotNumber || row.batchNumber,
    batchNumber: row.batchNumber,
    mfgBatchNo: row.mfgBatchNo || null,
    productId: row.productId?._id || row.productId,
    productName: row.productId?.productName || "—",
    warehouseId: row.warehouseId?._id || row.warehouseId,
    destination: row.warehouseId?.name || "—",
    qty: row.inTransitStock,
    mfgDate: row.mfgDate || null,
    expiryDate: row.expiryDate || null,
    status: "awaiting_receipt",
  };
}

/**
 * CONFIRM RECEIPT of a pending lot at the warehouse. Atomically moves the whole
 * in-transit qty onto the books, writes the single `supply_in` ledger row, and
 * activates the lot's already-generated child units (generated/printed →
 * in_stock) — their serial, lotNumber, productId and printed flag are untouched
 * and no unit is created or deleted. Conditional on inTransitStock, so a repeat
 * confirm can never double-add.
 */
async function confirmLotReceipt(companyId, inventoryId, { performedBy, allowedWarehouseIds = null } = {}) {
  const row = await Inventory.findOne({ _id: inventoryId, ownerType: "company", ownerId: companyId });
  if (!row) throw httpErr("Lot not found.", 404);
  if (Array.isArray(allowedWarehouseIds) && !allowedWarehouseIds.map(String).includes(String(row.warehouseId))) {
    throw httpErr("This lot is not assigned to your warehouse.", 403);
  }
  const qty = Number(row.inTransitStock || 0);
  if (qty <= 0) throw httpErr("This transfer has already been received.", 409);

  const inv = await withTransaction(async (session) => {
    // Conditional on the exact pending qty — a concurrent/repeat confirm fails.
    const doc = await Inventory.findOneAndUpdate(
      { _id: row._id, ownerType: "company", ownerId: companyId, inTransitStock: { $gte: qty } },
      {
        $inc: { inTransitStock: -qty, offlineStock: qty, availableStock: qty },
        $set: { receivedAt: new Date(), receivedBy: performedBy || null },
      },
      { new: true, session }
    );
    if (!doc) throw httpErr("This transfer has already been received.", 409);
    await ledger(doc, {
      type: "supply_in", channel: "internal", quantity: qty,
      refType: "Transfer", refId: doc._id, performedBy,
      note: `Lot ${doc.lotNumber || doc.batchNumber} received into warehouse`,
      session,
    });

    // Child units already minted for this lot become available HERE — never
    // before the receipt. Same row, so parent lot + serials are unchanged.
    const units = await UnitSerial.find({
      ownerType: "company", ownerId: companyId, inventoryId: doc._id,
      status: { $in: ["generated", "printed"] },
    }).session(session);
    if (units.length) {
      await UnitSerial.updateMany(
        { _id: { $in: units.map((u) => u._id) } },
        { $set: { status: "in_stock" } },
        { session }
      );
      await UnitEvent.insertMany(
        units.map((u) => ({ companyId: u.companyId, serial: u.serial, event: "in_stock", fromStatus: u.status, toStatus: "in_stock", refType: "Transfer", refId: doc._id, actorId: performedBy })),
        { session }
      );
    }
    return doc;
  });

  emitInventoryUpdate(inv);
  return inv;
}

/* ---------- operations ---------- */

/**
 * Stock-in one lot. Upserts the (product, owner, warehouse, batch) row
 * that the existing unique index already enforces, sets lot metadata,
 * and writes a supply_in ledger entry.
 *
 * If a `session` is passed, the work runs INSIDE that transaction (no new one)
 * — this lets callers like postGRN receive many lots atomically in a single
 * transaction. Without a session it opens its own via withTransaction.
 */
async function receiveLot({
  ownerId,
  productId,
  warehouseId = null,
  lotNumber,
  batchNumber,
  mfgBatchNo,
  expiryDate = null,
  mfgDate = null,
  qty,
  lowStockThreshold,
  performedBy,
  note,
  refType,
  refId,
  unitCost,
  session,
  // Company → Company Warehouse assignment: book the qty to the warehouse as
  // IN TRANSIT instead of stocking it. The warehouse must scan the parent lot
  // and Confirm Receive (confirmLotReceipt) before it becomes available. GRN
  // posting and every other caller leave this false — a GRN *is* the receipt.
  pendingReceipt = false,
}) {
  if (!productId || !qty || qty <= 0) {
    const err = new Error("productId, batchNumber and positive qty are required");
    err.status = 400;
    throw err;
  }
  // Lot number is the SINGLE identity. A manually-typed lotNumber wins; a
  // client-supplied batchNumber is honoured as the lot only when no lotNumber
  // was given (legacy callers) — never as a separate value. When neither is
  // supplied the system auto-generates the Khetify number.
  // The batch column always SHADOWS the lot number so the two can never
  // diverge; it survives only as the unique-index key (CLAUDE.md invariant #3).
  let lot = lotNumber || batchNumber;
  if (!lot) {
    lot = await autoLotNumber(ownerId, warehouseId, session);
    if (!lot) {
      const err = new Error("productId, a lot number and positive qty are required");
      err.status = 400;
      throw err;
    }
  }
  lotNumber = lot;
  batchNumber = lot;
  const setFields = { lotNumber: lot, batchNumber: lot };
  // Manufacturer/supplier batch number — a SEPARATE, optional, display-only
  // value. It never participates in the lot identity/index, so it can't clash
  // with the batchNumber shadow above. Trimmed; blank → left unset (null).
  if (typeof mfgBatchNo === "string") {
    const trimmed = mfgBatchNo.trim();
    if (trimmed) setFields.mfgBatchNo = trimmed;
  }
  if (expiryDate) setFields.expiryDate = expiryDate;
  if (mfgDate) setFields.mfgDate = mfgDate;
  if (typeof lowStockThreshold === "number") setFields.lowStockThreshold = lowStockThreshold;

  const core = async (s) => {
    // Capacity guard: this lot's qty must fit within the destination warehouse's
    // remaining space. Checked inside the txn so it sees earlier lines' stock-in
    // (e.g. a multi-line GRN) and the cap holds cumulatively.
    await assertWarehouseCapacity({ ownerType: "company", ownerId, warehouseId, addQty: qty, session: s });

    // Weighted-average cost: recompute from the pre-receipt row when a unitCost
    // is supplied. Done as a read-then-write within the same session.
    if (typeof unitCost === "number" && unitCost >= 0) {
      const prev = await Inventory.findOne({ productId, ownerType: "company", ownerId, warehouseId, batchNumber }).session(s || null);
      const prevQty = prev ? (prev.offlineStock || 0) + (prev.onlineStock || 0) : 0;
      const prevCost = prev?.costPrice || 0;
      setFields.costPrice = prevQty + qty > 0 ? (prevQty * prevCost + qty * unitCost) / (prevQty + qty) : unitCost;
    }
    // PENDING RECEIPT: book the qty to the warehouse as in-transit only. It is
    // NOT stock yet — no offline/available, and therefore NO ledger row (the
    // ledger tracks stock on the books; the single `supply_in` is written by
    // confirmLotReceipt when the warehouse actually receives it).
    if (pendingReceipt) {
      const pending = await Inventory.findOneAndUpdate(
        { productId, ownerType: "company", ownerId, warehouseId, batchNumber },
        { $inc: { inTransitStock: qty }, $set: { ...setFields, receivedAt: null, receivedBy: null } },
        { new: true, upsert: true, session: s }
      );
      return pending;
    }

    const doc = await Inventory.findOneAndUpdate(
      { productId, ownerType: "company", ownerId, warehouseId, batchNumber },
      { $inc: { offlineStock: qty, availableStock: qty }, $set: setFields },
      { new: true, upsert: true, session: s }
    );
    await ledger(doc, {
      type: "supply_in",
      channel: "internal",
      quantity: qty,
      refType: refType || "Manual",
      refId,
      performedBy,
      note: note || `Lot ${setFields.lotNumber} received`,
      session: s,
    });
    return doc;
  };

  // Run within the caller's transaction if given, else open our own.
  const inv = session ? await core(session) : await withTransaction(core);

  emitInventoryUpdate(inv);
  return inv;
}

/**
 * Move qty of a lot row to another warehouse. Atomic on the source
 * (filter requires availableStock >= qty), upserts the destination row
 * with the same batch/lot/expiry, and writes transfer_out + transfer_in.
 */
async function transferLot({ inventoryId, toWarehouseId, qty, performedBy }) {
  qty = Number(qty);
  if (!inventoryId || !toWarehouseId || !qty || qty <= 0) {
    const err = new Error("inventoryId, toWarehouseId and positive qty are required");
    err.status = 400;
    throw err;
  }
  // Block transfer-OUT from a warehouse under audit freeze.
  const srcRow = await Inventory.findById(inventoryId).select("warehouseId ownerId ownerType");
  if (srcRow) {
    const frozen = await frozenWarehouseIds(srcRow.ownerId);
    if (frozen.has(String(srcRow.warehouseId))) {
      const err = new Error("Source warehouse is under an audit freeze — transfers out are blocked");
      err.status = 409;
      throw err;
    }
    // Capacity guard on the DESTINATION warehouse. Checked BEFORE mutating the
    // source so a rejection never leaves a partial write on a standalone (dev)
    // MongoDB that has no transaction to roll back. A same-warehouse move is a
    // net-zero occupancy change, so it's skipped.
    if (String(srcRow.warehouseId) !== String(toWarehouseId)) {
      await assertWarehouseCapacity({ ownerType: srcRow.ownerType, ownerId: srcRow.ownerId, warehouseId: toWarehouseId, addQty: qty });
    }
  }
  const { src, dest } = await withTransaction(async (session) => {
    const srcDoc = await Inventory.findOneAndUpdate(
      { _id: inventoryId, availableStock: { $gte: qty } },
      { $inc: { offlineStock: -qty, availableStock: -qty } },
      { new: true, session }
    );
    if (!srcDoc) {
      const err = new Error("INSUFFICIENT_STOCK");
      err.status = 409;
      throw err;
    }
    const destDoc = await Inventory.findOneAndUpdate(
      {
        productId: srcDoc.productId,
        ownerType: srcDoc.ownerType,
        ownerId: srcDoc.ownerId,
        warehouseId: toWarehouseId,
        batchNumber: srcDoc.batchNumber,
      },
      {
        $inc: { offlineStock: qty, availableStock: qty },
        $set: { lotNumber: srcDoc.lotNumber, expiryDate: srcDoc.expiryDate },
      },
      { new: true, upsert: true, session }
    );
    await ledger(srcDoc, { type: "transfer_out", quantity: -qty, refType: "Transfer", performedBy, session });
    await ledger(destDoc, { type: "transfer_in", quantity: qty, refType: "Transfer", performedBy, session });
    return { src: srcDoc, dest: destDoc };
  });

  emitInventoryUpdate(src);
  emitInventoryUpdate(dest);
  await checkLowStock(src); // source dropped — may have crossed its threshold
  return { src, dest };
}

/**
 * FEFO sale: deduct qty of a product from its NON-EXPIRED lots,
 * earliest expiry first. Returns the per-lot breakdown so the caller
 * can print it on the invoice / picklist.
 */
async function sellFEFO({ ownerType = "company", ownerId, productId, qty, channel = "offline", refId, performedBy, warehouseId }) {
  qty = Number(qty);
  const now = new Date();
  const lotFilter = {
    productId,
    ownerType,
    ownerId,
    availableStock: { $gt: 0 },
    $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
  };
  if (warehouseId) lotFilter.warehouseId = warehouseId; // restrict to a single store/warehouse
  const allLots = await Inventory.find(lotFilter).sort({ expiryDate: 1 });

  // Lots in a warehouse under audit freeze cannot be picked.
  const frozen = await frozenWarehouseIds(ownerId);
  const lots = allLots.filter((l) => !frozen.has(String(l.warehouseId)));

  const total = lots.reduce((s, l) => s + l.availableStock, 0);
  if (total < qty) {
    const totalAll = allLots.reduce((s, l) => s + l.availableStock, 0);
    if (totalAll >= qty) {
      const err = new Error("Stock is under an audit freeze — selling is blocked until the audit completes");
      err.status = 409;
      throw err;
    }
    const err = new Error(`INSUFFICIENT_STOCK (have ${total}, need ${qty})`);
    err.status = 409;
    throw err;
  }

  const stockField = channel === "online" ? "onlineStock" : "offlineStock";
  const type = channel === "online" ? "sale_online" : "sale_offline";

  // Allocate across lots atomically. The whole deduction either commits or
  // rolls back, so a mid-loop failure can't leave a partial sale. Updated
  // docs are collected and emitted AFTER commit (never emit a rolled-back row).
  const { consumed, touched } = await withTransaction(async (session) => {
    const consumedLocal = [];
    const touchedLocal = [];
    let remaining = qty;

    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.availableStock, remaining);
      const inv = await Inventory.findOneAndUpdate(
        { _id: lot._id, availableStock: { $gte: take } },
        { $inc: { [stockField]: -take, availableStock: -take } },
        { new: true, session }
      );
      if (!inv) continue; // raced; next lot covers it
      remaining -= take;
      consumedLocal.push({ inventoryId: inv._id, lotNumber: inv.lotNumber, batchNumber: inv.batchNumber, qty: take });
      await ledger(inv, {
        type,
        channel,
        quantity: -take,
        refType: "Order",
        refId,
        performedBy,
        note: `FEFO pick from lot ${inv.lotNumber || inv.batchNumber}`,
        session,
      });
      touchedLocal.push(inv);
    }
    if (remaining > 0) {
      const err = new Error("CONCURRENT_STOCK_CHANGE — retry");
      err.status = 409;
      throw err;
    }
    return { consumed: consumedLocal, touched: touchedLocal };
  });

  for (const inv of touched) {
    emitInventoryUpdate(inv);
    await checkLowStock(inv); // lot dropped — may have crossed its threshold
  }
  return consumed;
}

/**
 * FEFO RESERVE: move qty of a product from available → reserved across its
 * non-expired, non-frozen lots (earliest expiry first), recording the per-lot
 * allocation so dispatch can commit exactly what was reserved. Returns the
 * allocation array to store on the order line.
 */
async function allocateFEFO({ ownerType = "company", ownerId, productId, qty, refId, refType = "Order", performedBy, warehouseId }) {
  qty = Number(qty);
  const now = new Date();
  const allLots = await Inventory.find({
    productId,
    ownerType,
    ownerId,
    ...(warehouseId ? { warehouseId } : {}), // restrict to a single source warehouse (supply)
    availableStock: { $gt: 0 },
    $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
  }).sort({ expiryDate: 1 });

  const frozen = await frozenWarehouseIds(ownerId);
  const lots = allLots.filter((l) => !frozen.has(String(l.warehouseId)));
  const total = lots.reduce((s, l) => s + l.availableStock, 0);
  if (total < qty) {
    const totalAll = allLots.reduce((s, l) => s + l.availableStock, 0);
    const err = new Error(totalAll >= qty ? "Stock is under an audit freeze" : `INSUFFICIENT_STOCK (have ${total}, need ${qty})`);
    err.status = 409;
    throw err;
  }

  const { allocations, touched } = await withTransaction(async (session) => {
    const allocs = [];
    const touchedLocal = [];
    let remaining = qty;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.availableStock, remaining);
      const inv = await Inventory.findOneAndUpdate(
        { _id: lot._id, availableStock: { $gte: take } },
        { $inc: { reservedStock: take, availableStock: -take } },
        { new: true, session }
      );
      if (!inv) continue;
      remaining -= take;
      allocs.push({ inventoryId: inv._id, lotNumber: inv.lotNumber, batchNumber: inv.batchNumber, warehouseId: inv.warehouseId, qty: take, committed: false, serials: [] });
      await ledger(inv, { type: "reserve", channel: "internal", quantity: -take, refType, refId, performedBy, note: `Reserve from lot ${inv.lotNumber || inv.batchNumber}`, session });
      touchedLocal.push(inv);
    }
    if (remaining > 0) {
      const err = new Error("CONCURRENT_STOCK_CHANGE — retry");
      err.status = 409;
      throw err;
    }
    return { allocations: allocs, touched: touchedLocal };
  });

  for (const inv of touched) emitInventoryUpdate(inv);
  return allocations;
}

/**
 * PLAN which lot(s) will fulfil `qty` — the READ-ONLY twin of allocateFEFO.
 * Moves NO stock and writes NO ledger row.
 *
 * Used by SUPPLY APPROVAL, which is AUTHORIZATION ONLY: it records the intended
 * source lot(s) so the warehouse knows what to pick, but the stock must stay
 * fully available until the warehouse actually PICKS it (reserveLotQty).
 * Availability here is an advisory pre-check; the authoritative check is the
 * conditional reserve at pick.
 *
 * Pass `inventoryId` to plan ONE specific parent lot; omit it for FEFO order.
 */
async function planAllocation({ ownerType = "company", ownerId, productId, qty, warehouseId, inventoryId }) {
  qty = Number(qty);
  if (!qty || qty <= 0) { const e = new Error("A positive qty is required"); e.status = 400; throw e; }
  const now = new Date();

  let lots;
  if (inventoryId) {
    const lot = await Inventory.findOne({ _id: inventoryId, ownerType, ownerId });
    if (!lot) { const e = new Error("Selected lot not found"); e.status = 404; throw e; }
    if (warehouseId && String(lot.warehouseId) !== String(warehouseId)) {
      const e = new Error("Selected lot is not in the chosen source warehouse"); e.status = 400; throw e;
    }
    lots = [lot];
  } else {
    lots = await Inventory.find({
      productId, ownerType, ownerId,
      ...(warehouseId ? { warehouseId } : {}),
      availableStock: { $gt: 0 },
      $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
    }).sort({ expiryDate: 1 });
  }

  const frozen = await frozenWarehouseIds(ownerId);
  lots = lots.filter((l) => !frozen.has(String(l.warehouseId)));
  const total = lots.reduce((s, l) => s + (l.availableStock || 0), 0);
  if (total < qty) { const e = new Error(`INSUFFICIENT_STOCK (have ${total}, need ${qty})`); e.status = 409; throw e; }

  const allocs = [];
  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.availableStock, remaining);
    remaining -= take;
    allocs.push({
      inventoryId: lot._id, lotNumber: lot.lotNumber, batchNumber: lot.batchNumber,
      warehouseId: lot.warehouseId, qty: take, reservedQty: 0, committed: false, serials: [],
    });
  }
  return allocs;
}

/**
 * RESERVE `qty` on ONE lot — this is the moment stock stops being available.
 * Called at PICK (not at approval). Atomic + conditional on availableStock, so
 * two picks can never reserve the same units. Writes one `reserve` ledger row.
 */
async function reserveLotQty({ ownerType = "company", ownerId, inventoryId, qty, refType = "SupplyOrder", refId, performedBy, session }) {
  qty = Number(qty);
  if (!qty || qty <= 0) return null;
  const run = async (s) => {
    const inv = await Inventory.findOneAndUpdate(
      { _id: inventoryId, ownerType, ownerId, availableStock: { $gte: qty } },
      { $inc: { reservedStock: qty, availableStock: -qty } },
      { new: true, session: s }
    );
    if (!inv) { const e = new Error("INSUFFICIENT_STOCK — this lot no longer has enough available stock"); e.status = 409; throw e; }
    await ledger(inv, { type: "reserve", channel: "internal", quantity: -qty, refType, refId, performedBy, note: `Reserve from lot ${inv.lotNumber || inv.batchNumber}`, session: s });
    return inv;
  };
  const inv = session ? await run(session) : await withTransaction(run);
  emitInventoryUpdate(inv);
  return inv;
}

/**
 * RELEASE `qty` reserved on ONE lot back to available (cancel BEFORE dispatch).
 * Never called once an allocation is committed (dispatched) — those goods have
 * physically left and only the return flow may bring them back.
 */
async function releaseLotQty({ ownerType = "company", ownerId, inventoryId, qty, refType = "SupplyOrder", refId, performedBy }) {
  qty = Number(qty);
  if (!qty || qty <= 0) return null;
  const inv = await withTransaction(async (session) => {
    const row = await Inventory.findOneAndUpdate(
      { _id: inventoryId, ownerType, ownerId, reservedStock: { $gte: qty } },
      { $inc: { reservedStock: -qty, availableStock: qty } },
      { new: true, session }
    );
    if (!row) return null; // nothing reserved to release
    await ledger(row, { type: "release", channel: "internal", quantity: qty, refType, refId, performedBy, note: `Release lot ${row.lotNumber || row.batchNumber}`, session });
    return row;
  });
  if (inv) emitInventoryUpdate(inv);
  return inv;
}

/**
 * Reserve `qty` from ONE specific lot (Inventory row) — the lot-specific
 * counterpart to allocateFEFO. Used when the operator chooses the exact PARENT
 * LOT to fulfil from (e.g. a lot-specific company → seller transfer), so the
 * reserved allocation IS that lot and its child unit serials validate at pick
 * (the pick checks unit.inventoryId ∈ the order's reserved allocations).
 *
 * Same reservation semantics as FEFO: availableStock → reservedStock, one
 * `reserve` ledger row, identical allocation shape. Reserves NOTHING extra —
 * this does not create stock; it just moves the lot's available into reserved.
 */
async function allocateFromLot({ ownerType = "company", ownerId, inventoryId, qty, warehouseId, refId, refType = "SupplyOrder", performedBy }) {
  qty = Number(qty);
  if (!inventoryId || !qty || qty <= 0) {
    const err = new Error("inventoryId and a positive qty are required");
    err.status = 400;
    throw err;
  }
  const lot = await Inventory.findOne({ _id: inventoryId, ownerType, ownerId });
  if (!lot) { const err = new Error("Selected lot not found"); err.status = 404; throw err; }
  // The chosen lot must sit in the assigned source warehouse.
  if (warehouseId && String(lot.warehouseId) !== String(warehouseId)) {
    const err = new Error("Selected lot is not in the chosen source warehouse"); err.status = 400; throw err;
  }
  const frozen = await frozenWarehouseIds(ownerId);
  if (frozen.has(String(lot.warehouseId))) { const err = new Error("Selected lot is under an audit freeze"); err.status = 409; throw err; }
  if ((lot.availableStock || 0) < qty) {
    const err = new Error(`INSUFFICIENT_STOCK (lot has ${lot.availableStock || 0}, need ${qty})`); err.status = 409; throw err;
  }

  const { allocations, touched } = await withTransaction(async (session) => {
    const inv = await Inventory.findOneAndUpdate(
      { _id: lot._id, availableStock: { $gte: qty } },
      { $inc: { reservedStock: qty, availableStock: -qty } },
      { new: true, session }
    );
    if (!inv) { const err = new Error("CONCURRENT_STOCK_CHANGE — retry"); err.status = 409; throw err; }
    await ledger(inv, { type: "reserve", channel: "internal", quantity: -qty, refType, refId, performedBy, note: `Reserve from lot ${inv.lotNumber || inv.batchNumber}`, session });
    return {
      allocations: [{ inventoryId: inv._id, lotNumber: inv.lotNumber, batchNumber: inv.batchNumber, warehouseId: inv.warehouseId, qty, committed: false, serials: [] }],
      touched: [inv],
    };
  });
  for (const inv of touched) emitInventoryUpdate(inv);
  return allocations;
}

/**
 * COMMIT a stored allocation on dispatch: reserved → out of the channel bucket
 * (the actual sale). Writes a sale ledger row per lot. Idempotent per
 * allocation via the `committed` flag (caller sets it after success).
 */
// ownerType is accepted for API symmetry with the other FEFO helpers; commit
// targets specific inventory _ids (already owner-bound), so it needs no filter.
async function commitAllocation({ ownerType = "company", ownerId, allocations, channel = "offline", refId, performedBy }) {
  const stockField = channel === "online" ? "onlineStock" : "offlineStock";
  const type = channel === "online" ? "sale_online" : "sale_offline";
  return withTransaction(async (session) => {
    for (const a of allocations) {
      if (a.committed) continue;
      const inv = await Inventory.findOneAndUpdate(
        { _id: a.inventoryId, reservedStock: { $gte: a.qty } },
        { $inc: { reservedStock: -a.qty, [stockField]: -a.qty } },
        { new: true, session }
      );
      if (!inv) {
        const err = new Error("NO_RESERVATION to commit (was it already dispatched?)");
        err.status = 409;
        throw err;
      }
      a.committed = true;
      await ledger(inv, { type, channel, quantity: -a.qty, refType: "Order", refId, performedBy, note: `Dispatch from lot ${a.lotNumber || a.batchNumber}`, session });
      emitInventoryUpdate(inv);
    }
    return allocations;
  });
}

/**
 * COMMIT a SUPPLY allocation on dispatch (company → seller). Like
 * commitAllocation, but the goods go to another owner rather than being sold:
 * reserved → out of offlineStock, and the ledger row is `supply_out` with
 * refType "SupplyOrder" (never `sale_*`, so company sales analytics stay clean
 * — CLAUDE.md). availableStock is unchanged: it was already reduced when the
 * stock was reserved at approval, and here reservedStock and offlineStock both
 * drop by qty, so online+offline−reserved holds. The seller side lands the
 * matching `supply_in` at scan-verified receipt.
 */
async function commitSupplyAllocation({ ownerId, allocations, refId, performedBy }) {
  return withTransaction(async (session) => {
    for (const a of allocations) {
      if (a.committed) continue;
      const qty = a.qty ?? a.quantity;
      const inv = await Inventory.findOneAndUpdate(
        { _id: a.inventoryId, reservedStock: { $gte: qty } },
        { $inc: { reservedStock: -qty, offlineStock: -qty } },
        { new: true, session }
      );
      if (!inv) {
        const err = new Error("NO_RESERVATION to dispatch (was the supply already dispatched?)");
        err.status = 409;
        throw err;
      }
      a.committed = true;
      await ledger(inv, { type: "supply_out", channel: "internal", quantity: -qty, refType: "SupplyOrder", refId, performedBy, note: `Supply dispatch from lot ${a.lotNumber || a.batchNumber}`, session });
      emitInventoryUpdate(inv);
    }
    return allocations;
  });
}

/**
 * RELEASE a stored allocation (order cancelled before dispatch):
 * reserved → available again. Only releases not-yet-committed allocations.
 */
async function releaseAllocation({ ownerType = "company", ownerId, allocations, refId, performedBy }) {
  return withTransaction(async (session) => {
    for (const a of allocations) {
      if (a.committed) continue;
      const inv = await Inventory.findOneAndUpdate(
        { _id: a.inventoryId, reservedStock: { $gte: a.qty } },
        { $inc: { reservedStock: -a.qty, availableStock: a.qty } },
        { new: true, session }
      );
      if (!inv) continue; // nothing to release
      await ledger(inv, { type: "release", channel: "internal", quantity: a.qty, refType: "Order", refId, performedBy, note: `Release lot ${a.lotNumber || a.batchNumber}`, session });
      emitInventoryUpdate(inv);
    }
    return allocations;
  });
}

/**
 * SUPPLY TRANSFER (company → seller): lot-accurate, atomic, traceable.
 *
 * FEFO-consumes the company's earliest-expiry non-expired, non-frozen lots
 * FROM THE ASSIGNED SOURCE WAREHOUSE only, and MIRRORS each consumed lot into
 * the seller's destination warehouse, PRESERVING the company's lotNumber /
 * batchNumber / expiryDate / mfgDate (farm-to-dealer traceability). Company
 * side writes `supply_out`, the seller side `supply_in`, both with refType
 * "SupplyOrder" — never `sale_*`, so company sales analytics stay clean.
 * Everything runs in ONE transaction; any shortfall throws 409 and rolls back.
 *
 * onlineStock / reservedStock are untouched on both sides, so
 * availableStock = online + offline − reserved holds throughout.
 *
 * Returns [{ productId, lots: [{ lotNumber, qty }] }].
 */
async function supplyTransfer({ companyId, sellerId, sourceWarehouseId, destWarehouseId, items, refId, performedBy }) {
  if (!companyId || !sellerId || !destWarehouseId) {
    const err = new Error("companyId, sellerId and destWarehouseId are required");
    err.status = 400;
    throw err;
  }
  if (!sourceWarehouseId) {
    const err = new Error("A source warehouse must be assigned to fulfil this supply");
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("items[] are required");
    err.status = 400;
    throw err;
  }
  // The source must be a company warehouse; the destination a seller warehouse.
  await assertCompanyWarehouse(companyId, sourceWarehouseId);
  await assertSellerWarehouse(sellerId, destWarehouseId);

  const now = new Date();
  const frozen = await frozenWarehouseIds(companyId);

  const { summary, touched } = await withTransaction(async (session) => {
    const summaryLocal = [];
    const touchedLocal = [];

    for (const item of items) {
      const productId = item.productId;
      let remaining = Number(item.quantity);
      if (!productId || !remaining || remaining <= 0) {
        const err = new Error("each item needs a productId and a positive quantity");
        err.status = 400;
        throw err;
      }

      // Company lots IN THE ASSIGNED SOURCE WAREHOUSE, FEFO (earliest expiry
      // first), non-expired, non-frozen.
      const allLots = await Inventory.find({
        productId,
        ownerType: "company",
        ownerId: companyId,
        warehouseId: sourceWarehouseId,
        availableStock: { $gt: 0 },
        $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
      }).sort({ expiryDate: 1 }).session(session);
      const lots = allLots.filter((l) => !frozen.has(String(l.warehouseId)));

      const total = lots.reduce((s, l) => s + l.availableStock, 0);
      if (total < remaining) {
        const err = new Error(`INSUFFICIENT_STOCK (have ${total}, need ${remaining})`);
        err.status = 409;
        throw err;
      }

      const perItemLots = [];
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.availableStock, remaining);

        // Capacity guard on the seller's destination warehouse, BEFORE moving
        // any stock (so a standalone/dev MongoDB with no rollback can't be left
        // with a partial move). The running increments from earlier lots in
        // this same session are counted via the occupancy read.
        await assertWarehouseCapacity({ ownerType: "seller", ownerId: sellerId, warehouseId: destWarehouseId, addQty: take, session });

        // Company OUT — guarded decrement so a race can't oversell.
        const srcDoc = await Inventory.findOneAndUpdate(
          { _id: lot._id, availableStock: { $gte: take } },
          { $inc: { offlineStock: -take, availableStock: -take } },
          { new: true, session }
        );
        if (!srcDoc) continue; // raced; a later lot covers it
        remaining -= take;
        await ledger(srcDoc, {
          type: "supply_out", channel: "internal", quantity: -take,
          refType: "SupplyOrder", refId, performedBy,
          note: `Supply out lot ${srcDoc.lotNumber || srcDoc.batchNumber} → seller`,
          session,
        });
        touchedLocal.push(srcDoc);

        // Seller IN — mirror the lot identity into the seller's warehouse.
        const destDoc = await Inventory.findOneAndUpdate(
          { productId, ownerType: "seller", ownerId: sellerId, warehouseId: destWarehouseId, batchNumber: srcDoc.batchNumber },
          {
            $inc: { offlineStock: take, availableStock: take },
            $setOnInsert: { lotNumber: srcDoc.lotNumber, expiryDate: srcDoc.expiryDate, mfgDate: srcDoc.mfgDate },
          },
          { new: true, upsert: true, session }
        );
        await ledger(destDoc, {
          type: "supply_in", channel: "internal", quantity: take,
          refType: "SupplyOrder", refId, performedBy,
          note: `Supply in lot ${destDoc.lotNumber || destDoc.batchNumber} ← company`,
          session,
        });
        touchedLocal.push(destDoc);

        // UNIT-LEVEL TRANSFER (Phase 4b): the LABELED portion of this lot moves
        // with the goods. Re-point up to `take` available units of the company
        // lot to the seller (same serials — globally unique, never re-minted),
        // and log a per-unit event. Any unlabeled remainder stays as the
        // lot-level seller stock upserted above. Sellers never mint serials.
        const movable = await UnitSerial.find({
          ownerType: "company", ownerId: companyId, inventoryId: srcDoc._id,
          status: { $in: ["generated", "printed", "in_stock"] },
        }).limit(take).session(session);
        if (movable.length) {
          const ids = movable.map((u) => u._id);
          await UnitSerial.updateMany(
            { _id: { $in: ids } },
            { $set: { ownerType: "seller", ownerId: sellerId, inventoryId: destDoc._id, currentLocationId: null, status: "in_stock" } },
            { session }
          );
          await UnitEvent.insertMany(
            movable.map((u) => ({
              companyId: u.companyId, serial: u.serial, event: "supplied_to_seller",
              fromStatus: u.status, toStatus: "in_stock", refType: "SupplyOrder", refId, actorId: performedBy,
            })),
            { session }
          );
        }

        perItemLots.push({ lotNumber: srcDoc.lotNumber || srcDoc.batchNumber, qty: take });
      }

      if (remaining > 0) {
        const err = new Error("CONCURRENT_STOCK_CHANGE — retry");
        err.status = 409;
        throw err;
      }
      summaryLocal.push({ productId, lots: perItemLots });
    }

    return { summary: summaryLocal, touched: touchedLocal };
  });

  // Post-commit side effects (never emit a rolled-back row).
  for (const inv of touched) {
    emitInventoryUpdate(inv);
    await checkLowStock(inv);
  }
  return summary;
}

module.exports = { getLots, receiveLot, findPendingLot, confirmLotReceipt, transferLot, sellFEFO, allocateFEFO, allocateFromLot, planAllocation, reserveLotQty, releaseLotQty, commitAllocation, commitSupplyAllocation, releaseAllocation, supplyTransfer, generateKhetifyLotNumber, autoLotNumber };
