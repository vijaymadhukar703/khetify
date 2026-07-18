/**
 * GET /api/auth/me — the header display profile (company side).
 *
 * The header shows the PERSON on line 1 and their ORGANISATION on line 2, so
 * /me carries both: `name` (account holder or team member), `companyName` (the
 * business), and `warehouses` (assigned IDs resolved to names — the session only
 * ever carried IDs).
 *
 * NB Company.fullName is an AUTH field: the account holder's own name ("Aakash").
 * The business name is companyInfo.companyName ("Khetify Agro Pvt. Ltd.").
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Warehouse = require("../model/Warehouse/Warehouse");
const User = require("../model/User/User");
const { me } = require("../controller/Auth/authController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyId, indore, bhopal;

beforeEach(async () => {
  const c = await Company.create({
    fullName: "Aakash",
    email: `a-${new mongoose.Types.ObjectId()}@x.com`,
    password: "x",
    companyInfo: { companyName: "Khetify Agro Pvt. Ltd." },
  });
  companyId = c._id;
  indore = await Warehouse.create({ companyId, name: "Indore Warehouse", code: "IND" });
  bhopal = await Warehouse.create({ companyId, name: "Bhopal Warehouse", code: "BPL" });
});

const callMe = async (user) => {
  const res = mockRes();
  await me({ user }, res);
  return res.body.data;
};

// Company-owner tokens are signed with id === companyId.
const ownerUser = () => ({ id: companyId, companyId, role: "company_admin" });

describe("main company", () => {
  test("owner: name is the account holder, companyName is the business", async () => {
    const d = await callMe(ownerUser());
    expect(d.name).toBe("Aakash");
    expect(d.companyName).toBe("Khetify Agro Pvt. Ltd.");
  });

  test("with no business name on file, companyName falls back to the holder's name", async () => {
    await Company.updateOne({ _id: companyId }, { $unset: { "companyInfo.companyName": "" } });
    const d = await callMe(ownerUser());
    // The header drops a second line identical to the first — see DashboardLayout.
    expect(d.name).toBe("Aakash");
    expect(d.companyName).toBe("Aakash");
  });

  test("a company_admin TEAM MEMBER sees their OWN name, not the account holder's", async () => {
    const member = await User.create({
      companyId, name: "Priya", email: `p-${new mongoose.Types.ObjectId()}@x.com`,
      password: "x", role: "company_admin",
    });
    const d = await callMe({ id: member._id, companyId, role: "company_admin" });
    expect(d.name).toBe("Priya");
    expect(d.companyName).toBe("Khetify Agro Pvt. Ltd.");
  });
});

describe("company warehouse", () => {
  test("a warehouse user gets their assigned warehouse resolved to a NAME", async () => {
    const yogesh = await User.create({
      companyId, name: "Yogesh", email: `y-${new mongoose.Types.ObjectId()}@x.com`,
      password: "x", role: "operations_manager", warehouseIds: [indore._id],
    });

    const d = await callMe({ id: yogesh._id, companyId, role: "operations_manager" });

    expect(d.name).toBe("Yogesh");
    expect(d.warehouses).toEqual([{ _id: String(indore._id), name: "Indore Warehouse" }]);
    expect(d.warehouseIds).toEqual([String(indore._id)]); // unchanged, still IDs
  });

  test("multiple assigned warehouses all resolve", async () => {
    const u = await User.create({
      companyId, name: "Karan", email: `k-${new mongoose.Types.ObjectId()}@x.com`,
      password: "x", role: "warehouse_manager", warehouseIds: [indore._id, bhopal._id],
    });
    const d = await callMe({ id: u._id, companyId, role: "warehouse_manager" });
    expect(d.warehouses.map((w) => w.name).sort()).toEqual(["Bhopal Warehouse", "Indore Warehouse"]);
  });

  test("warehouse names never cross tenants", async () => {
    const other = await Company.create({ fullName: "Rival", email: `r-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
    const theirs = await Warehouse.create({ companyId: other._id, name: "Rival Depot", code: "RVL" });
    const u = await User.create({
      companyId, name: "Snoop", email: `s-${new mongoose.Types.ObjectId()}@x.com`,
      password: "x", role: "operations_manager", warehouseIds: [theirs._id],
    });

    const d = await callMe({ id: u._id, companyId, role: "operations_manager" });

    expect(d.warehouses).toEqual([]); // scoped by companyId — another tenant's name never leaks
  });

  test("an unassigned user has no warehouses", async () => {
    const u = await User.create({
      companyId, name: "Floater", email: `f-${new mongoose.Types.ObjectId()}@x.com`,
      password: "x", role: "operations_manager",
    });
    const d = await callMe({ id: u._id, companyId, role: "operations_manager" });
    expect(d.warehouses).toEqual([]);
  });
});

describe("the existing RBAC contract is unchanged", () => {
  test("role, capabilities, deniedCapabilities and warehouseIds still ship", async () => {
    const d = await callMe(ownerUser());
    expect(d.role).toBe("company_admin");
    expect(String(d.id)).toBe(String(companyId));
    expect(String(d.companyId)).toBe(String(companyId));
    expect(d.capabilities).toContain("*");
    // company_admin is denied inventory:transfer despite the wildcard.
    expect(d.deniedCapabilities).toContain("inventory:transfer");
    expect(d.warehouseIds).toEqual([]); // "*" roles are never warehouse-scoped
  });

  test("a wildcard role is still never warehouse-scoped, even if a User doc lists warehouses", async () => {
    const admin = await User.create({
      companyId, name: "Admin", email: `ad-${new mongoose.Types.ObjectId()}@x.com`,
      password: "x", role: "company_admin", warehouseIds: [indore._id],
    });
    const d = await callMe({ id: admin._id, companyId, role: "company_admin" });
    expect(d.warehouseIds).toEqual([]);
    expect(d.warehouses).toEqual([]);
  });
});
