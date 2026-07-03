const mongoose = require("mongoose");
const Location = require("../model/Warehouse/Location");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const InventoryBin = require("../model/Inventory/InventoryBin");
const StockMovement = require("../model/Inventory/StockMovement");
const { withTransaction } = require("./txn");

/* ---------------------------------------------------------------- helpers */

function httpErr(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

/** Stable prefix for a warehouse's fullCodes. Uses its code, else a WH<id4>. */
function warehousePrefix(wh) {
  const base = (wh.code && String(wh.code).trim()) || `WH${String(wh._id).slice(-4)}`;
  return base.toUpperCase().replace(/\s+/g, "");
}

/** Zone labels A..Z then Z27, Z28… (rarely needed past 26). */
function zoneCode(i) {
  return i < 26 ? String.fromCharCode(65 + i) : `Z${i + 1}`;
}
const pad = (n, w = 2) => String(n).padStart(w, "0");

/** Validate the warehouse belongs to the company and return it. */
async function getOwnedWarehouse(companyId, warehouseId, session) {
  const wh = await Warehouse.findOne({ _id: warehouseId, companyId }).session(session || null);
  if (!wh) throw httpErr("Warehouse not found", 404);
  return wh;
}

/* ----------------------------------------------------------- create one */

/**
 * Create a single location. fullCode is derived from the parent's fullCode
 * (or the warehouse prefix for a top-level zone) + this node's `code`.
 */
async function createLocation(
  companyId,
  { warehouseId, parentId = null, type, code, capacityUnits = 0, allowedCategories = [], isPickFace = false }
) {
  if (!type || !code) throw httpErr("type and code are required");
  code = String(code).trim().toUpperCase();

  const wh = await getOwnedWarehouse(companyId, warehouseId);

  let prefix;
  if (parentId) {
    const parent = await Location.findOne({ _id: parentId, companyId, warehouseId });
    if (!parent) throw httpErr("Parent location not found", 404);
    prefix = parent.fullCode;
  } else {
    prefix = warehousePrefix(wh);
  }

  const fullCode = `${prefix}-${code}`;
  try {
    const loc = await Location.create({
      companyId,
      warehouseId,
      parentId,
      type,
      code,
      fullCode,
      barcode: fullCode,
      capacityUnits,
      allowedCategories,
      isPickFace,
    });
    return loc;
  } catch (err) {
    if (err.code === 11000) throw httpErr(`Location ${fullCode} already exists`, 409);
    throw err;
  }
}

/* -------------------------------------------------- bulk tree generator */

const MAX_NODES = 5000; // backstop against runaway generation

/**
 * Generate a full zone→rack→shelf→bin tree for a warehouse in one call.
 * Returns counts created. Only bins are pick faces and carry capacity.
 */
async function generateTree(
  companyId,
  { warehouseId, zones = 1, racksPerZone = 1, shelvesPerRack = 1, binsPerShelf = 1, binCapacity = 0 }
) {
  zones = Number(zones);
  racksPerZone = Number(racksPerZone);
  shelvesPerRack = Number(shelvesPerRack);
  binsPerShelf = Number(binsPerShelf);
  if ([zones, racksPerZone, shelvesPerRack, binsPerShelf].some((n) => !Number.isInteger(n) || n < 1)) {
    throw httpErr("zones, racksPerZone, shelvesPerRack and binsPerShelf must be positive integers");
  }

  const totalBins = zones * racksPerZone * shelvesPerRack * binsPerShelf;
  const totalNodes = zones + zones * racksPerZone + zones * racksPerZone * shelvesPerRack + totalBins;
  if (totalNodes > MAX_NODES) {
    throw httpErr(`Refusing to create ${totalNodes} locations (limit ${MAX_NODES}). Generate in smaller batches.`);
  }

  const wh = await getOwnedWarehouse(companyId, warehouseId);
  const prefix = warehousePrefix(wh);
  const docs = [];
  const base = { companyId, warehouseId };

  const mk = (parentId, type, code, fullCode, extra = {}) => {
    const _id = new mongoose.Types.ObjectId();
    docs.push({ _id, ...base, parentId, type, code, fullCode, barcode: fullCode, ...extra });
    return { _id, fullCode };
  };

  for (let z = 0; z < zones; z++) {
    const zc = zoneCode(z);
    const zone = mk(null, "zone", zc, `${prefix}-${zc}`);
    for (let r = 1; r <= racksPerZone; r++) {
      const rc = `R${pad(r)}`;
      const rack = mk(zone._id, "rack", rc, `${zone.fullCode}-${rc}`);
      for (let s = 1; s <= shelvesPerRack; s++) {
        const sc = `S${s}`;
        const shelf = mk(rack._id, "shelf", sc, `${rack.fullCode}-${sc}`);
        for (let b = 1; b <= binsPerShelf; b++) {
          const bc = `B${pad(b)}`;
          mk(shelf._id, "bin", bc, `${shelf.fullCode}-${bc}`, {
            isPickFace: true,
            capacityUnits: Number(binCapacity) || 0,
          });
        }
      }
    }
  }

  try {
    await Location.insertMany(docs, { ordered: false });
  } catch (err) {
    if (err.code === 11000 || err.writeErrors) {
      throw httpErr("Some locations already exist for this warehouse — clear or rename before regenerating", 409);
    }
    throw err;
  }

  return {
    created: docs.length,
    zones,
    racks: zones * racksPerZone,
    shelves: zones * racksPerZone * shelvesPerRack,
    bins: totalBins,
  };
}

/* -------------------------------------------------------------- queries */

/** Flat list of a warehouse's locations (the frontend builds the tree). */
async function listLocations(companyId, { warehouseId, warehouseIds, type } = {}) {
  const filter = { companyId };
  if (warehouseId) filter.warehouseId = warehouseId;
  // Warehouse-level access control (services/warehouseScope.js).
  else if (Array.isArray(warehouseIds) && warehouseIds.length) filter.warehouseId = { $in: warehouseIds };
  if (type) filter.type = type;
  return Location.find(filter).sort({ fullCode: 1 });
}

/** Total binned qty for an inventory row (optionally within a txn). */
async function binnedQty(inventoryId, session) {
  const rows = await InventoryBin.aggregate([
    { $match: { inventoryId: new mongoose.Types.ObjectId(inventoryId) } },
    { $group: { _id: null, total: { $sum: "$qty" } } },
  ]).session(session || null);
  return rows.length ? rows[0].total : 0;
}

/* ------------------------------------------------------------ bin moves */

async function ledgerBinMove(inv, qty, note, performedBy, session) {
  await StockMovement.create(
    [
      {
        inventoryId: inv._id,
        productId: inv.productId,
        ownerType: inv.ownerType,
        ownerId: inv.ownerId,
        type: "bin_move",
        channel: "internal",
        quantity: qty, // amount relocated; Inventory totals are unchanged
        balanceAfter: inv.availableStock,
        refType: "BinMove",
        performedBy,
        note,
      },
    ],
    session ? { session } : {}
  );
}

/**
 * Move `qty` of an inventory row between storage locations, atomically.
 *
 *   fromLocationId = null  → take from the unbinned receiving pool (putaway)
 *   toLocationId   = null  → return to the unbinned pool (de-bin / pre-pick)
 *   both set               → relocate bin → bin
 *
 * Preserves the invariant sum(bins) <= total stock: a pool→bin move checks
 * that enough unbinned stock exists; bin→bin keeps the sum constant.
 */
async function moveBinStock({ companyId, fromLocationId = null, toLocationId = null, inventoryId, qty, performedBy }) {
  qty = Number(qty);
  if (!inventoryId || !qty || qty <= 0) throw httpErr("inventoryId and positive qty are required");
  if (!fromLocationId && !toLocationId) throw httpErr("at least one of fromLocationId / toLocationId is required");
  if (fromLocationId && toLocationId && String(fromLocationId) === String(toLocationId)) {
    throw httpErr("source and destination bins are the same");
  }

  const inv = await Inventory.findOne({ _id: inventoryId, ownerId: companyId, ownerType: "company" });
  if (!inv) throw httpErr("Inventory row not found", 404);

  // Validate destination bin belongs to the same warehouse as the inventory row.
  let toLoc = null;
  if (toLocationId) {
    toLoc = await Location.findOne({ _id: toLocationId, companyId, type: "bin" });
    if (!toLoc) throw httpErr("Destination must be an existing bin", 404);
    if (inv.warehouseId && String(toLoc.warehouseId) !== String(inv.warehouseId)) {
      throw httpErr("Destination bin is in a different warehouse than this stock", 409);
    }
  }
  let fromLoc = null;
  if (fromLocationId) {
    fromLoc = await Location.findOne({ _id: fromLocationId, companyId, type: "bin" });
    if (!fromLoc) throw httpErr("Source must be an existing bin", 404);
  }

  return withTransaction(async (session) => {
    if (fromLocationId) {
      // Decrement source bin atomically — fails if it doesn't hold enough.
      const src = await InventoryBin.findOneAndUpdate(
        { inventoryId, locationId: fromLocationId, qty: { $gte: qty } },
        { $inc: { qty: -qty } },
        { new: true, session }
      );
      if (!src) throw httpErr("INSUFFICIENT_STOCK in source bin", 409, "INSUFFICIENT_STOCK");
    } else {
      // From the unbinned pool: ensure enough un-put-away stock exists.
      const total = (inv.onlineStock || 0) + (inv.offlineStock || 0);
      const binned = await binnedQty(inventoryId, session);
      if (total - binned < qty) {
        throw httpErr(`INSUFFICIENT_STOCK in receiving pool (unbinned ${total - binned}, need ${qty})`, 409, "INSUFFICIENT_STOCK");
      }
    }

    if (toLocationId) {
      await InventoryBin.findOneAndUpdate(
        { inventoryId, locationId: toLocationId },
        { $inc: { qty }, $setOnInsert: { companyId } },
        { new: true, upsert: true, session }
      );
    }

    const fromLabel = fromLoc ? fromLoc.fullCode : "RECEIVING-POOL";
    const toLabel = toLoc ? toLoc.fullCode : "RECEIVING-POOL";
    await ledgerBinMove(inv, qty, `Bin move ${fromLabel} → ${toLabel}`, performedBy, session);

    return { inventoryId, qty, from: fromLabel, to: toLabel };
  });
}

/**
 * Suggest a destination bin for putaway of `productId` in `warehouseId`.
 * Rule (in order):
 *   1. a pick-face bin already holding the same product (consolidation)
 *   2. the emptiest bin in a zone whose allowedCategories matches the category
 *   3. any active bin
 * Returns a Location doc or null when the warehouse has no bins.
 */
async function suggestBin(companyId, { warehouseId, productId, category }) {
  // 1) pick-face bin already holding this product
  if (productId) {
    const invIds = await Inventory.find({ ownerId: companyId, ownerType: "company", warehouseId, productId }).distinct("_id");
    if (invIds.length) {
      const occupied = await InventoryBin.find({ inventoryId: { $in: invIds }, qty: { $gt: 0 } })
        .populate({ path: "locationId", match: { warehouseId, isPickFace: true, isActive: true } });
      const hit = occupied.find((b) => b.locationId); // populate match filters non-pick-faces to null
      if (hit) return hit.locationId;
    }
  }

  // candidate bins (optionally category-restricted)
  const binFilter = { companyId, warehouseId, type: "bin", isActive: true };
  let bins = await Location.find(binFilter);
  if (category) {
    const matching = bins.filter((b) => !b.allowedCategories.length || b.allowedCategories.includes(category));
    if (matching.length) bins = matching;
  }
  if (!bins.length) return null;

  // 2/3) emptiest bin = most free capacity (treat capacity 0 as "unlimited-ish")
  const occByLoc = await InventoryBin.aggregate([
    { $match: { locationId: { $in: bins.map((b) => b._id) } } },
    { $group: { _id: "$locationId", used: { $sum: "$qty" } } },
  ]);
  const usedMap = new Map(occByLoc.map((r) => [String(r._id), r.used]));
  bins.sort((a, b) => {
    const freeA = (a.capacityUnits || Infinity) - (usedMap.get(String(a._id)) || 0);
    const freeB = (b.capacityUnits || Infinity) - (usedMap.get(String(b._id)) || 0);
    return freeB - freeA; // most free first
  });
  return bins[0];
}

module.exports = {
  createLocation,
  generateTree,
  listLocations,
  binnedQty,
  moveBinStock,
  suggestBin,
  // exported for tests / putaway
  warehousePrefix,
};
