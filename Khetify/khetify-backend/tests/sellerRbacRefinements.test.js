const mongoose = require("mongoose");
require("../model/Company/Company"); // register Company (getLots populates productId.companyId)
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const User = require("../model/User/User");
const SellerTransfer = require("../model/Seller/SellerTransfer");
const { hasCapability } = require("../config/permissions");
const authorize = require("../middlewares/authorize");
const { warehouseScope } = require("../services/warehouseScope");
const { ownerFromUser, ensureSubscription } = require("../services/subscriptionService");
const sellerTransferService = require("../services/sellerTransferService");
const lotsCtrl = require("../controller/Seller/sellerInventoryController");
const whCtrl = require("../controller/Seller/sellerWarehouseController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const runAuth = (role, cap) => { let n = false; const res = mockRes(); authorize(cap)({ user: { role } }, res, () => { n = true; }); return { n, code: res.statusCode }; };

let companyId, sellerId, productId, whA, whB, manager;
beforeEach(async () => {
  companyId = new mongoose.Types.ObjectId();
  sellerId = new mongoose.Types.ObjectId();
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 270 });
  productId = p._id;
  whA = await Warehouse.create({ sellerId, name: "WH-A" });
  whB = await Warehouse.create({ sellerId, name: "WH-B" });
  // a manager assigned to WH-A only (a User owned by the seller account)
  manager = await User.create({ ownerType: "seller", ownerId: sellerId, name: "Mgr", role: "seller_manager", status: "active", warehouseIds: [whA._id] });
});

/* ───────────── PART 1 — subscription inherited from the OWNER seller ───────────── */
describe("PART 1 — team members inherit the seller's subscription", () => {
  test("ownerFromUser resolves a seller team-member token to the OWNER seller (not the member)", () => {
    const memberToken = { id: manager._id, sellerId, principalType: "seller", role: "seller_manager" };
    expect(ownerFromUser(memberToken)).toEqual({ ownerType: "seller", ownerId: sellerId });
  });

  test("a Pro seller's member resolves the Pro plan with no own subscription", async () => {
    // seller (owner) goes Pro
    const owner = { ownerType: "seller", ownerId: sellerId };
    const sub = await ensureSubscription(owner);
    sub.plan = "pro"; sub.status = "active"; await sub.save();

    // member token → same owner → same Pro subscription (no per-user sub created)
    const memberOwner = ownerFromUser({ id: manager._id, sellerId, principalType: "seller", role: "seller_staff" });
    const resolved = await ensureSubscription(memberOwner);
    expect(String(resolved._id)).toBe(String(sub._id));
    expect(resolved.plan).toBe("pro");
    expect(resolved.ownerType).toBe("seller");
  });
});

/* ───────────── PART 2 — warehouse-manager scope ───────────── */
describe("PART 2 — seller_manager is scoped to assigned warehouse(s)", () => {
  test("warehouseScope owner-aware: manager → their warehouse; seller_admin → unscoped", async () => {
    const mgrScope = await warehouseScope({ id: manager._id, sellerId, principalType: "seller", role: "seller_manager" });
    expect(mgrScope).toEqual([String(whA._id)]);
    // seller_admin (caps "*") is never scoped
    const adminScope = await warehouseScope({ id: sellerId, sellerId, principalType: "seller", role: "seller_admin" });
    expect(adminScope).toBeNull();
  });

  test("warehouse list + lots are limited to the manager's warehouse; admin sees both", async () => {
    await Inventory.create({ productId, ownerType: "seller", ownerId: sellerId, warehouseId: whA._id, batchNumber: "A-1", lotNumber: "A-1", offlineStock: 20, availableStock: 20 });
    await Inventory.create({ productId, ownerType: "seller", ownerId: sellerId, warehouseId: whB._id, batchNumber: "B-1", lotNumber: "B-1", offlineStock: 15, availableStock: 15 });

    const mgrUser = { id: manager._id, sellerId, principalType: "seller", role: "seller_manager" };
    const adminUser = { id: sellerId, sellerId, principalType: "seller", role: "seller_admin" };

    const whRes = mockRes();
    await whCtrl.getSellerWarehouses({ user: mgrUser }, whRes);
    expect(whRes.body.data.map((w) => w.name)).toEqual(["WH-A"]);

    const lotsRes = mockRes();
    await lotsCtrl.getSellerLots({ user: mgrUser, query: {} }, lotsRes);
    expect(lotsRes.body.data.map((l) => l.lotNumber)).toEqual(["A-1"]); // WH-B lot hidden

    const adminLots = mockRes();
    await lotsCtrl.getSellerLots({ user: adminUser, query: {} }, adminLots);
    expect(adminLots.body.count).toBe(2); // admin sees both — same source of truth
  });
});

/* ───────────── PART 3 — no catalog for the warehouse manager ───────────── */
describe("PART 3 — seller_manager has no catalog access", () => {
  test("capability + authorize: manager blocked, staff/admin allowed", () => {
    expect(hasCapability("seller_manager", "catalog:read")).toBe(false);
    expect(hasCapability("seller_staff", "catalog:read")).toBe(true);
    expect(hasCapability("seller_admin", "catalog:read")).toBe(true);

    expect(runAuth("seller_manager", "catalog:read").code).toBe(403);
    expect(runAuth("seller_staff", "catalog:read").n).toBe(true);
    expect(runAuth("seller_admin", "catalog:read").n).toBe(true);
  });
});

/* ───────────── PART 4 — seller inter-warehouse transfer ───────────── */
describe("PART 4 — seller inter-warehouse transfer", () => {
  test("manager has transfer caps; company transfer rules unchanged", () => {
    expect(hasCapability("seller_manager", "transfer:create")).toBe(true);
    expect(hasCapability("seller_manager", "transfer:read")).toBe(true);
    expect(hasCapability("seller_staff", "transfer:create")).toBe(false); // read-only
    expect(hasCapability("seller_staff", "transfer:read")).toBe(true);
    // company side untouched
    expect(hasCapability("company_admin", "inventory:transfer")).toBe(false);
    expect(hasCapability("operations_manager", "inventory:transfer")).toBe(true);
  });

  // The transfer now rides the shipment lifecycle (request → accept → dispatch →
  // scan-receive). The full stock move + ledger + invariant is covered in
  // sellerTransferShipment.test.js; here we keep the RBAC/scoping guarantees.
  test("creating a request A→B records it (no stock moves until accept/dispatch)", async () => {
    const lot = await Inventory.create({ productId, ownerType: "seller", ownerId: sellerId, warehouseId: whA._id, batchNumber: "A-1", lotNumber: "A-1", offlineStock: 50, availableStock: 50 });
    const { doc } = await sellerTransferService.createRequest({
      sellerId, fromWarehouseId: whA._id, toWarehouseId: whB._id, productId, qty: 20, requestedBy: manager._id, scope: [String(whA._id)],
    });
    expect(String(doc.fromWarehouseId._id)).toBe(String(whA._id));
    expect(String(doc.toWarehouseId._id)).toBe(String(whB._id));
    expect(doc.status).toBe("requested");
    // stock untouched until the shipment dispatches
    expect((await Inventory.findById(lot._id)).availableStock).toBe(50);
  });

  test("a manager cannot request a transfer OUT of a warehouse they aren't assigned to", async () => {
    await expect(sellerTransferService.createRequest({
      sellerId, fromWarehouseId: whB._id, toWarehouseId: whA._id, productId, qty: 5, requestedBy: manager._id, scope: [String(whA._id)],
    })).rejects.toThrow(/assigned warehouse/);
  });

  test("transfer requests list is scoped: a manager sees only requests touching their warehouse", async () => {
    await sellerTransferService.createRequest({ sellerId, fromWarehouseId: whA._id, toWarehouseId: whB._id, productId, qty: 5, requestedBy: manager._id, scope: null });
    const other = await Warehouse.create({ sellerId, name: "WH-C" });
    const other2 = await Warehouse.create({ sellerId, name: "WH-D" });
    await sellerTransferService.createRequest({ sellerId, fromWarehouseId: other._id, toWarehouseId: other2._id, productId, qty: 3, requestedBy: sellerId, scope: null });

    const scoped = await sellerTransferService.listRequests(sellerId, [String(whA._id)]);
    expect(scoped).toHaveLength(1);
    const all = await sellerTransferService.listRequests(sellerId, null);
    expect(all).toHaveLength(2);
  });
});
