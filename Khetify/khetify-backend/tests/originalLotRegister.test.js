/**
 * ORIGINAL LOT REGISTER (Main Company Inventory).
 *
 * Inventory.originalQuantity is immutable: written once at creation and never
 * moved by a transfer, sale, pick, reservation or return. Inventory.lotOrigin
 * says who minted the row, so the register can drop transfer-landing copies —
 * which carry the source's lot identity verbatim and are otherwise
 * indistinguishable from an original lot.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const User = require("../model/User/User");
const lotService = require("../services/lotService");
const { backfillOriginalQuantity } = require("../scripts/migrations/005-original-lot-quantity");

let companyId, productId, bhopal, indore;

beforeEach(async () => {
  const c = await Company.create({ fullName: "Aakash", email: `a-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = c._id;
  bhopal = await Warehouse.create({ companyId, name: "Bhopal Warehouse", code: "BPL" });
  indore = await Warehouse.create({ companyId, name: "Indore Warehouse", code: "IND" });
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "U1", mrp: 10 });
  productId = p._id;
});

/**
 * Mirrors the real Main Company flow: company_admin + a warehouseId books the lot
 * as pending (lotController sets pendingReceipt), and the warehouse's Confirm
 * Receive puts it on the books. `stock: false` stops before the confirm.
 */
const createCompanyLot = async (qty, { stock = true, warehouseId = bhopal._id } = {}) => {
  const inv = await lotService.receiveLot({
    ownerId: companyId, productId, warehouseId, lotNumber: "KH-BPL-202607-0001",
    qty, performedBy: companyId, pendingReceipt: true, lotOrigin: "company",
  });
  if (!stock) return inv;
  return lotService.confirmLotReceipt(companyId, inv._id, { performedBy: companyId });
};

const registerRows = () => lotService.getLots(companyId, { lotOrigin: "company" });

describe("originalQuantity is written at creation and never moves", () => {
  test("a company-minted lot records its created quantity and origin", async () => {
    const inv = await createCompanyLot(3000);
    expect(inv.originalQuantity).toBe(3000);
    expect(inv.lotOrigin).toBe("company");
  });

  test("a warehouse→warehouse transfer leaves originalQuantity at 3000 while live stock drops", async () => {
    const lot = await createCompanyLot(3000);

    await lotService.transferLot({ inventoryId: lot._id, toWarehouseId: indore._id, qty: 300, performedBy: companyId });

    const src = await Inventory.findById(lot._id);
    expect(src.originalQuantity).toBe(3000); // register: unchanged
    expect(src.availableStock).toBe(2700);   // live: correctly reduced
  });

  test("a sale (FEFO deduction) does not move originalQuantity", async () => {
    const lot = await createCompanyLot(3000);

    await lotService.sellFEFO({ ownerId: companyId, productId, qty: 500, performedBy: companyId });

    const row = await Inventory.findById(lot._id);
    expect(row.originalQuantity).toBe(3000);
    expect(row.availableStock).toBe(2500);
  });

  test("re-receiving into the same lot adds stock but cannot rewrite the original", async () => {
    const first = await createCompanyLot(3000);

    // Same lot identity → upsert matches the existing row; $setOnInsert must no-op.
    await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: bhopal._id, lotNumber: "KH-BPL-202607-0001",
      qty: 500, performedBy: companyId, lotOrigin: "company",
    });

    const row = await Inventory.findById(first._id);
    expect(row.originalQuantity).toBe(3000); // NOT 3500, NOT 500
  });
});

describe("the register lists only Main-Company lots", () => {
  test("the transfer's destination row is excluded, so the lot appears once at 3000", async () => {
    const lot = await createCompanyLot(3000);
    await lotService.transferLot({ inventoryId: lot._id, toWarehouseId: indore._id, qty: 300, performedBy: companyId });

    // Two rows exist for this lot number (Bhopal origin + Indore landing)...
    expect(await Inventory.countDocuments({ ownerId: companyId, batchNumber: "KH-BPL-202607-0001" })).toBe(2);

    // ...but the register shows only the original.
    const rows = await registerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].originalQuantity).toBe(3000);
    expect(String(rows[0].warehouseId._id)).toBe(String(bhopal._id)); // initially assigned warehouse
  });

  test("a warehouse-created lot is not on the register but keeps its live stock", async () => {
    await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: indore._id, lotNumber: "KH-IND-202607-0004",
      qty: 500, performedBy: new mongoose.Types.ObjectId(), lotOrigin: "warehouse",
    });

    expect(await registerRows()).toHaveLength(0);
    // The unfiltered list (Company Warehouse view) still has it, live.
    const all = await lotService.getLots(companyId, {});
    expect(all).toHaveLength(1);
    expect(all[0].availableStock).toBe(500);
  });
});

describe("migration 005 — reconstruct from the ledger", () => {
  /** Strip the new fields to simulate a pre-migration row. */
  const makeLegacy = async (id) =>
    Inventory.updateOne({ _id: id }, { $set: { originalQuantity: null, lotOrigin: null } });

  test("an already-transferred lot is reconstructed to 3000, not its live 2700", async () => {
    const lot = await createCompanyLot(3000);
    await lotService.transferLot({ inventoryId: lot._id, toWarehouseId: indore._id, qty: 300, performedBy: companyId });
    await makeLegacy(lot._id);

    await backfillOriginalQuantity({ log: () => {} });

    const row = await Inventory.findById(lot._id);
    expect(row.originalQuantity).toBe(3000);
    expect(row.lotOrigin).toBe("company");
    expect(row.availableStock).toBe(2700); // live stock untouched by the migration
  });

  test("the transfer-landing row is labelled `transfer` and gets no original quantity", async () => {
    const lot = await createCompanyLot(3000);
    await lotService.transferLot({ inventoryId: lot._id, toWarehouseId: indore._id, qty: 300, performedBy: companyId });
    const dest = await Inventory.findOne({ ownerId: companyId, warehouseId: indore._id });
    await makeLegacy(dest._id);

    await backfillOriginalQuantity({ log: () => {} });

    const row = await Inventory.findById(dest._id);
    expect(row.lotOrigin).toBe("transfer");
    expect(row.originalQuantity).toBeNull();
  });

  test("a pending lot with no ledger yet reconstructs from inTransitStock", async () => {
    const lot = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: bhopal._id, lotNumber: "KH-BPL-202607-0009",
      qty: 800, performedBy: companyId, pendingReceipt: true, lotOrigin: "company",
    });
    expect(await StockMovement.countDocuments({ inventoryId: lot._id })).toBe(0); // no ledger by design
    await makeLegacy(lot._id);

    await backfillOriginalQuantity({ log: () => {} });

    const row = await Inventory.findById(lot._id);
    expect(row.originalQuantity).toBe(800);
    expect(row.lotOrigin).toBe("company");
  });

  test("a lot created by a WAREHOUSE user is labelled `warehouse`, keeping it off the register", async () => {
    const whUser = await User.create({
      companyId, name: "WH Op", email: `w-${new mongoose.Types.ObjectId()}@x.com`,
      password: "x", role: "operations_manager",
    });
    const lot = await lotService.receiveLot({
      ownerId: companyId, productId, warehouseId: indore._id, lotNumber: "KH-IND-202607-0007",
      qty: 600, performedBy: whUser._id, lotOrigin: "warehouse",
    });
    await makeLegacy(lot._id);

    await backfillOriginalQuantity({ log: () => {} });

    const row = await Inventory.findById(lot._id);
    expect(row.lotOrigin).toBe("warehouse");
    expect(await registerRows()).toHaveLength(0);
  });

  test("pre-ledger stock is flagged for review, never guessed", async () => {
    // Seed-style row: stock on the books, no movements, nothing in transit.
    const orphan = await Inventory.create({
      productId, ownerType: "company", ownerId: companyId, warehouseId: bhopal._id,
      batchNumber: "SEED-1", lotNumber: "SEED-1", offlineStock: 100, availableStock: 100,
    });

    const r = await backfillOriginalQuantity({ log: () => {} });

    const row = await Inventory.findById(orphan._id);
    expect(row.originalQuantity).toBeNull(); // NOT 100 — unproven, so not invented
    expect(row.lotOrigin).toBe("unknown");
    expect(r.flaggedLots).toContain("SEED-1");
  });

  test("re-running is idempotent and cannot overwrite a reconstructed value", async () => {
    const lot = await createCompanyLot(3000);
    await makeLegacy(lot._id);

    await backfillOriginalQuantity({ log: () => {} });
    await lotService.transferLot({ inventoryId: lot._id, toWarehouseId: indore._id, qty: 300, performedBy: companyId });
    const second = await backfillOriginalQuantity({ log: () => {} });

    expect(second.updated).toBe(0); // nothing left to do
    expect((await Inventory.findById(lot._id)).originalQuantity).toBe(3000);
  });
});
