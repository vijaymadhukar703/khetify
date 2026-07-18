/**
 * Child unit serials are controlled by the MAIN COMPANY. A company-warehouse
 * role may view, print and reprint the labels it received, but must never mint
 * new unit records — enforced in barcodeService.generateUnits, because the
 * route's authorize("lot:receive") cannot express it: warehouse roles need that
 * very capability for GRN/receive.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const UnitSerial = require("../model/Barcode/UnitSerial");
const svc = require("../services/barcodeService");
const { WAREHOUSE_ROLES, hasCapability } = require("../config/permissions");

let companyId, inv;

beforeEach(async () => {
  const c = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = c._id;
  const wh = await Warehouse.create({ companyId, name: "Main", code: "WH1" });
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "U1" });
  inv = await Inventory.create({
    productId: p._id, ownerType: "company", ownerId: companyId, warehouseId: wh._id,
    batchNumber: "B1", lotNumber: "LOT1", offlineStock: 100, availableStock: 100,
  });
});

const generateAs = (role) => svc.generateUnits(companyId, inv._id, 5, { role });

describe("generateUnits() — main-company-only role guard", () => {
  test.each([...WAREHOUSE_ROLES])("%s is rejected with the main-company message", async (role) => {
    await expect(generateAs(role)).rejects.toMatchObject({
      status: 403,
      message: "Only the Main Company can generate unit labels.",
    });
    // and nothing was minted
    expect(await UnitSerial.countDocuments({ companyId, inventoryId: inv._id })).toBe(0);
  });

  test("company_admin (Main Company) still generates normally", async () => {
    const r = await generateAs("company_admin");
    expect(r.generated).toBe(5);
    expect(await UnitSerial.countDocuments({ companyId, inventoryId: inv._id })).toBe(5);
  });

  test("super_admin is unaffected", async () => {
    await expect(generateAs("super_admin")).resolves.toMatchObject({ generated: 5 });
  });

  test("an omitted role is not blocked — internal callers/seeds keep working", async () => {
    await expect(svc.generateUnits(companyId, inv._id, 5)).resolves.toMatchObject({ generated: 5 });
  });

  test("the guard is a ROLE rule, not a capability one: warehouse roles keep lot:receive", () => {
    // Proves the guard could not have been expressed as an authorize()/ROLE_DENIED
    // change without also breaking GRN/receive for these roles.
    for (const role of WAREHOUSE_ROLES) {
      expect(hasCapability(role, "lot:receive")).toBe(true);
    }
  });

  test("printing and listing stay open to a warehouse — only generation is barred", async () => {
    await svc.generateUnits(companyId, inv._id, 3); // minted by the main company
    const owner = { ownerType: "company", ownerId: companyId };

    const units = await svc.listUnits(owner, { inventoryId: inv._id });
    expect(units).toHaveLength(3);

    // markPrinted takes no role — a warehouse reprints freely.
    const r = await svc.markPrinted(owner, units.map((u) => u.serial), { actorId: new mongoose.Types.ObjectId() });
    expect(r.moved).toHaveLength(3);
  });
});
