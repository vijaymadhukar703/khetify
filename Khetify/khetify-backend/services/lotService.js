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
async function getLots(ownerId, { ownerType = "company", productId, warehouseId, warehouseIds, expiring, expired } = {}) {
  const filter = {
    ownerType,
    ownerId,
    batchNumber: { $ne: null },
  };
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

module.exports = { getLots, receiveLot, transferLot, sellFEFO, allocateFEFO, commitAllocation, commitSupplyAllocation, releaseAllocation, supplyTransfer, generateKhetifyLotNumber, autoLotNumber };
