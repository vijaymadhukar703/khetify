const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const User = require("../model/User/User");
const lotService = require("../services/lotService");
const { warehouseScope, inScope } = require("../services/warehouseScope");

let companyId, productId, khargone, katni, opsUser;

beforeEach(async () => {
  const company = await Company.create({ fullName: "Scope Co", email: `s-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = company._id;
  khargone = await Warehouse.create({ companyId, name: "Khargone", code: "KHA" });
  katni = await Warehouse.create({ companyId, name: "Katni", code: "KAT" });
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR" });
  productId = p._id;
  opsUser = await User.create({ companyId, name: "Meetali", role: "operations_manager", warehouseIds: [khargone._id], status: "active" });

  // The ADMIN's stock: 100 units in Khargone, 40 in Katni — one source of truth.
  await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: khargone._id, batchNumber: "KH-LOT-1", qty: 100 });
  await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: katni._id, batchNumber: "KT-LOT-1", qty: 40 });
});

describe("admin ↔ manager data integration (warehouse scope)", () => {
  test("admin (company_admin) is unscoped and sees every warehouse's stock", async () => {
    const scope = await warehouseScope({ id: companyId, companyId, role: "company_admin" });
    expect(scope).toBeNull();
    const all = await lotService.getLots(companyId, {});
    expect(all.reduce((s, l) => s + l.availableStock, 0)).toBe(140);
  });

  test("the Khargone ops manager sees EXACTLY the admin's Khargone slice", async () => {
    // team-token shape: id = USER id, companyId = company — the bug class this guards against
    const scope = await warehouseScope({ id: opsUser._id, companyId, role: "operations_manager" });
    expect(scope).toEqual([String(khargone._id)]);

    const mine = await lotService.getLots(companyId, { warehouseIds: scope });
    expect(mine).toHaveLength(1);
    expect(mine[0].batchNumber).toBe("KH-LOT-1");
    expect(mine[0].availableStock).toBe(100); // same row the admin sees for Khargone

    expect(inScope(scope, katni._id)).toBe(false); // Katni stays invisible
  });

  test("(re)assignment applies immediately — scope reads the live User doc, not the JWT", async () => {
    await User.updateOne({ _id: opsUser._id }, { $set: { warehouseIds: [katni._id] } });
    // stale token still claims Khargone; the live doc wins
    const scope = await warehouseScope({ id: opsUser._id, companyId, role: "operations_manager", warehouseIds: [String(khargone._id)] });
    expect(scope).toEqual([String(katni._id)]);
  });

  test("an unassigned team user is unscoped (legacy behaviour preserved)", async () => {
    const u = await User.create({ companyId, name: "Unassigned", role: "operations_manager", status: "active" });
    expect(await warehouseScope({ id: u._id, companyId, role: "operations_manager" })).toBeNull();
  });
});
