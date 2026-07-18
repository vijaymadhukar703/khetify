const mongoose = require("mongoose");

/**
 * One document per (product, owner, location, batch).
 * availableStock is the ONLY number the marketplace reads for "in stock?".
 * availableStock = onlineStock + offlineStock - reservedStock
 */
const inventorySchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    ownerType: {
      type: String,
      enum: ["company", "seller"],
      required: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },

    // Premium (batch_expiry) — optional
    // NOTE: `batchNumber` is the lot IDENTITY key (part of the unique index
    // below) and is shadowed to equal `lotNumber` by lotService.receiveLot —
    // it is NOT a free-text manufacturer batch. The manufacturer/supplier batch
    // number entered per lot lives in `mfgBatchNo` (optional, non-indexed) so it
    // can be captured separately without touching the identity/index invariant.
    batchNumber: { type: String, default: null },
    lotNumber:   { type: String, default: null },
    mfgBatchNo:  { type: String, default: null }, // manufacturer/supplier batch no. (optional, display-only)
    expiryDate: { type: Date, default: null },
    mfgDate: { type: Date, default: null }, // manufacturing date, captured per lot

    onlineStock: { type: Number, default: 0 },
    offlineStock: { type: Number, default: 0 },
    reservedStock: { type: Number, default: 0 },
    damagedStock: { type: Number, default: 0 },
    availableStock: { type: Number, default: 0 },

    // Goods BOOKED to this warehouse but not yet RECEIVED by it (Company →
    // Company Warehouse assignment). Deliberately OUTSIDE the invariant
    // availableStock = onlineStock + offlineStock - reservedStock, so pending
    // stock is never sellable, pickable or transferable, and never lands in any
    // stock total. The warehouse's Confirm Receive moves it:
    //   inTransitStock -= qty ; offlineStock += qty ; availableStock += qty
    // and writes the single `supply_in` ledger row (nothing is "in stock" — and
    // so nothing is ledgered — until that receipt happens).
    inTransitStock: { type: Number, default: 0 },
    receivedAt: { type: Date, default: null },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    lowStockThreshold: { type: Number, default: 0 },

    // Weighted-average cost per unit, maintained on each receipt (GRN unitCost).
    // Drives stock valuation in reports.
    costPrice: { type: Number, default: 0 },

    // ABC velocity class (A=fast/high-value … C=slow). Set by the nightly
    // classifyABC job; drives cycle-count frequency guidance.
    abcClass: { type: String, enum: ["A", "B", "C", null], default: null },

    // ── ORIGINAL LOT REGISTER — IMMUTABLE, WRITE-ONCE ─────────────────────
    // Every other quantity above is a running balance that transfers, picks,
    // sales, returns and reservations move. These two are not: they record what
    // the lot WAS at creation, and nothing in the stock lifecycle may touch them
    // afterwards. The Main Company Inventory register reads them so a lot created
    // at 3000 still reads 3000 after 300 has moved to another warehouse — the
    // live 2700 stays correct on the Warehouse/Seller views, which read
    // availableStock as before.
    //
    // Written ONLY via $setOnInsert in lotService.receiveLot (so a re-receive
    // into the same lot row cannot overwrite the first value) and once by
    // scripts/migrations/005-original-lot-quantity.js for pre-existing rows.
    // NEVER add these to a $set/$inc in a movement path.
    originalQuantity: { type: Number, default: null },

    // How this row came into existence — a provenance stamp, not a status:
    //   company   — the Main Company minted the lot (role company_admin)
    //   warehouse — a Company Warehouse stocked it in via Receive Lot
    //   grn       — created by posting a GRN
    //   transfer  — a warehouse→warehouse transfer LANDED here. This row is a
    //               destination copy carrying the source's lot identity, not an
    //               original lot, so the Company register must exclude it.
    //   unknown   — pre-migration row whose origin could not be proven from the
    //               ledger. Flagged for review; never guessed at.
    // The Company register filters on "company" — see lotService.getLots.
    lotOrigin: {
      type: String,
      enum: ["company", "warehouse", "grn", "transfer", "unknown", null],
      default: null,
    },
  },
  { timestamps: true }
);

// One row per product/owner/location/batch.
inventorySchema.index(
  { productId: 1, ownerType: 1, ownerId: 1, warehouseId: 1, batchNumber: 1 },
  { unique: true }
);

module.exports = mongoose.model("Inventory", inventorySchema);
