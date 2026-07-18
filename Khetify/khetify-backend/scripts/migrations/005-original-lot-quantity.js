/**
 * Backfill Inventory.originalQuantity + Inventory.lotOrigin for rows created
 * before the original-lot register existed.
 *
 * WHY: every quantity on Inventory is a running balance, so a lot created at
 * 3000 that has since moved 300 to another warehouse reads 2700. The Main
 * Company register must still say 3000, so the created quantity is reconstructed
 * ONCE from the StockMovement ledger and stored. After this runs, nothing in the
 * stock lifecycle may touch either field again — new lots get them at creation
 * (lotService.receiveLot, via $setOnInsert).
 *
 * HOW a row's origin + created qty are proven (never guessed):
 *   - no ledger rows, inTransitStock > 0  → a Main-Company lot assigned to a
 *     warehouse and still awaiting Confirm Receive. receiveLot's pending branch
 *     writes NO ledger row, and nothing has moved, so inTransitStock IS the
 *     created qty.                                → company  / inTransitStock
 *   - earliest movement is `supply_in`, the creation receipt:
 *       refType "GRN"      → posted from a GRN     → grn       / that qty
 *       refType "Transfer" → written only by       → company   / that qty
 *                            confirmLotReceipt, i.e. a Company-assigned lot
 *                            the warehouse confirmed
 *       refType "Manual"   → created through Create/Receive Lot. The creator's
 *                            role decides: company_admin → company, a warehouse
 *                            role → warehouse.    → company|warehouse / that qty
 *   - earliest movement is `in_transit_in` / `transfer_in` → this row is a
 *     transfer LANDING copy, not an original lot.  → transfer / null
 *   - anything else (pre-ledger/seed stock, an unresolvable creator) →
 *     `unknown`, left with originalQuantity null and LOGGED for review.
 *     reconciliationService already documents that pre-ledger stock has no
 *     movements — those rows are reported, never invented.
 *
 * Idempotent: only ever touches rows whose originalQuantity is still null, and
 * writes each row once. Safe to re-run; a second run reports 0 updated.
 *
 *   node scripts/migrations/005-original-lot-quantity.js [--dry-run]
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Inventory = require("../../model/Inventory/Inventory");
const StockMovement = require("../../model/Inventory/StockMovement");
const User = require("../../model/User/User");
const { isWarehouseRole } = require("../../config/permissions");

const TRANSFER_IN_TYPES = new Set(["in_transit_in", "transfer_in"]);

/**
 * Resolve the creator of a `refType: "Manual"` supply_in to an origin.
 * Company-owner tokens are signed with id === companyId (see CLAUDE.md), so a
 * performedBy equal to the row's ownerId is the Main Company itself. Otherwise
 * the User's role decides. `cache` memoises the per-user lookups.
 */
async function originFromCreator(performedBy, ownerId, cache) {
  if (!performedBy) return "unknown";
  if (String(performedBy) === String(ownerId)) return "company";

  const key = String(performedBy);
  if (!cache.has(key)) {
    const user = await User.findById(performedBy).select("role").lean();
    cache.set(key, user?.role || null);
  }
  const role = cache.get(key);
  if (!role) return "unknown"; // creator gone — can't prove it, so flag it
  if (role === "company_admin") return "company";
  if (isWarehouseRole(role)) return "warehouse";
  return "unknown";
}

/** Decide { lotOrigin, originalQuantity } for one row. Never guesses a qty. */
async function classify(row, cache) {
  const first = await StockMovement.findOne({ inventoryId: row._id })
    .sort({ createdAt: 1, _id: 1 })
    .select("type quantity refType performedBy")
    .lean();

  if (!first) {
    // Nothing ever moved. Only a pending Company→Warehouse assignment legitimately
    // has stock but no ledger; anything else is pre-ledger/seed data.
    return Number(row.inTransitStock) > 0
      ? { lotOrigin: "company", originalQuantity: Number(row.inTransitStock) }
      : { lotOrigin: "unknown", originalQuantity: null };
  }

  if (TRANSFER_IN_TYPES.has(first.type)) {
    return { lotOrigin: "transfer", originalQuantity: null };
  }

  if (first.type !== "supply_in") {
    return { lotOrigin: "unknown", originalQuantity: null };
  }

  const qty = Number(first.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return { lotOrigin: "unknown", originalQuantity: null };

  if (first.refType === "GRN") return { lotOrigin: "grn", originalQuantity: qty };
  // confirmLotReceipt is the only writer of a supply_in with refType "Transfer",
  // and it only ever fires for a lot the Main Company assigned to a warehouse.
  if (first.refType === "Transfer") return { lotOrigin: "company", originalQuantity: qty };
  if (first.refType === "Manual" || !first.refType) {
    const lotOrigin = await originFromCreator(first.performedBy, row.ownerId, cache);
    return { lotOrigin, originalQuantity: lotOrigin === "unknown" ? null : qty };
  }
  return { lotOrigin: "unknown", originalQuantity: null };
}

async function backfillOriginalQuantity({ dryRun = false, log = console.log } = {}) {
  // Write-once: rows that already carry an originalQuantity are never revisited,
  // so a re-run cannot overwrite a reconstructed value.
  const rows = await Inventory.find({ ownerType: "company", originalQuantity: null })
    .select("_id ownerId inTransitStock lotNumber batchNumber warehouseId")
    .lean();

  const cache = new Map();
  const stats = { scanned: rows.length, updated: 0, flagged: 0, byOrigin: {} };
  const flagged = [];

  for (const row of rows) {
    const { lotOrigin, originalQuantity } = await classify(row, cache);
    stats.byOrigin[lotOrigin] = (stats.byOrigin[lotOrigin] || 0) + 1;

    if (lotOrigin === "unknown") {
      stats.flagged += 1;
      flagged.push(row.lotNumber || row.batchNumber || String(row._id));
    }

    if (!dryRun) {
      // Guarded on originalQuantity:null so a concurrent writer can't be clobbered.
      const set = { lotOrigin };
      if (originalQuantity !== null) set.originalQuantity = originalQuantity;
      await Inventory.updateOne({ _id: row._id, originalQuantity: null }, { $set: set });
    }
    if (originalQuantity !== null) stats.updated += 1;
  }

  log(`  • scanned ${stats.scanned} company lot row(s)`);
  for (const [origin, n] of Object.entries(stats.byOrigin)) log(`  • ${origin}: ${n}`);
  if (flagged.length) {
    log(`⚠️  ${flagged.length} lot(s) could NOT be proven from the ledger — left blank, marked lotOrigin "unknown" for review:`);
    for (const lot of flagged.slice(0, 50)) log(`     - ${lot}`);
    if (flagged.length > 50) log(`     … and ${flagged.length - 50} more`);
  }
  return { ...stats, flaggedLots: flagged };
}

module.exports = { backfillOriginalQuantity, classify };

if (require.main === module) {
  (async () => {
    const dryRun = process.argv.includes("--dry-run");
    await mongoose.connect(process.env.MONGO_URI);
    const r = await backfillOriginalQuantity({ dryRun });
    console.log(dryRun ? `✅ DRY RUN — would set ${r.updated} original quantity(ies)` : `✅ Set ${r.updated} original quantity(ies)`);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => { console.error("❌", e.message); process.exit(1); });
}
