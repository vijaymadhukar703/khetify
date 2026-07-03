const mongoose = require("mongoose");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const UnitSerial = require("../model/Barcode/UnitSerial");
const { publish } = require("./eventBus");

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Ledger types that change physical on-hand (onlineStock + offlineStock).
 * Excluded: reserve/release (hold only), damage/writeoff (damagedStock),
 * bin_move (relocation within a row — net-zero on totals).
 */
const ONHAND_TYPES = [
  "supply_in", "sale_online", "sale_offline", "return", "adjustment",
  "transfer_in", "transfer_out", "in_transit_in", "in_transit_out",
];

/**
 * Discrepancy prevention: recompute on-hand from the immutable ledger and
 * compare with stored Inventory; also flag when serialized units on hand
 * exceed the stored quantity. Run on demand (auditor) or daily.
 *
 * NOTE: stock created before the ledger existed (e.g. demo seed that $sets
 * quantities without a movement) will legitimately show LEDGER_VS_STOCK
 * mismatches — record one opening `adjustment` per row to align.
 */
async function runReconciliation(companyId) {
  const mismatches = [];
  const invRows = await Inventory.find({ ownerType: "company", ownerId: companyId });

  const sums = await StockMovement.aggregate([
    { $match: { ownerType: "company", ownerId: oid(companyId), type: { $in: ONHAND_TYPES } } },
    { $group: { _id: "$inventoryId", ledgerQty: { $sum: "$quantity" } } },
  ]);
  const ledgerMap = new Map(sums.map((s) => [String(s._id), s.ledgerQty]));

  for (const inv of invRows) {
    const stored = (inv.onlineStock || 0) + (inv.offlineStock || 0);
    const ledger = ledgerMap.get(String(inv._id));
    if (ledger !== undefined && ledger !== stored) {
      mismatches.push({ kind: "LEDGER_VS_STOCK", inventoryId: inv._id, productId: inv.productId, lotNumber: inv.lotNumber, stored, ledger, diff: stored - ledger });
    }
    const units = await UnitSerial.countDocuments({ companyId, inventoryId: inv._id, status: { $in: ["generated", "printed", "in_stock", "picked", "packed"] } });
    if (units > stored) {
      mismatches.push({ kind: "UNITS_EXCEED_STOCK", inventoryId: inv._id, lotNumber: inv.lotNumber, stored, units });
    }
  }

  if (mismatches.length) {
    await publish("INVENTORY_MISMATCH", companyId, { count: mismatches.length }, {
      notifyTitle: "Inventory reconciliation",
      notifyMsg: `${mismatches.length} inventory mismatch(es) detected — open the reconciliation report`,
    });
  }
  return { checkedRows: invRows.length, mismatchCount: mismatches.length, mismatches };
}

/** Run reconciliation across every company that has inventory (daily job). */
async function reconcileAllCompanies() {
  const companies = await Inventory.distinct("ownerId", { ownerType: "company" });
  let flagged = 0;
  for (const c of companies) {
    try { const r = await runReconciliation(c); if (r.mismatchCount) flagged += 1; }
    catch (e) { console.error("Reconciliation failed for", String(c), e.message); }
  }
  return { companies: companies.length, flagged };
}

module.exports = { runReconciliation, reconcileAllCompanies, ONHAND_TYPES };
