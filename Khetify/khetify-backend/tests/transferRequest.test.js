const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const TransferRequest = require("../model/Transport/TransferRequest");
const Shipment = require("../model/Transport/Shipment");
const lotService = require("../services/lotService");
const shipmentService = require("../services/shipmentService");
const ctrl = require("../controller/Transport/transferRequestController");

let companyId, productId, source, requester;

/** Minimal express-style res mock. */
function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const adminUser = () => ({ id: companyId, companyId, role: "company_admin" });
// An unscoped operations manager holds inventory:transfer (via inventory:*) and,
// with no warehouse assignment, passes the source-warehouse scope check.
const opsUser = () => ({ id: new mongoose.Types.ObjectId(), companyId, role: "operations_manager" });

beforeEach(async () => {
  const company = await Company.create({ fullName: "Req Co", email: `r-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = company._id;
  source = await Warehouse.create({ companyId, name: "Khargone", code: "KHA" });
  requester = await Warehouse.create({ companyId, name: "Katni", code: "KAT" });
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR" });
  productId = p._id;
});

const makeRequest = async (qty) =>
  TransferRequest.create({ companyId, productId, fromWarehouseId: source._id, toWarehouseId: requester._id, qty, requestedBy: new mongoose.Types.ObjectId() });

describe("transfer-request acceptance with stock verification", () => {
  test("insufficient stock at the source blocks the accept with an availability alert", async () => {
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: source._id, batchNumber: "L1", qty: 30 });
    const doc = await makeRequest(50);

    const res = mockRes();
    await ctrl.accept({ params: { id: doc._id }, body: {}, user: opsUser() }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/Stock not available/i);
    expect(res.body.data).toEqual({ available: 30, requested: 50 });
    const fresh = await TransferRequest.findById(doc._id);
    expect(fresh.status).toBe("requested"); // still pending — restock or reject
    expect(await Shipment.countDocuments({ companyId })).toBe(0); // nothing created
  });

  test("sufficient stock: accept performs the sending — FEFO shipment created and linked", async () => {
    // two lots; the earlier-expiring one must be picked first (FEFO)
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: source._id, batchNumber: "LATE", qty: 40, expiryDate: new Date("2027-01-01") });
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: source._id, batchNumber: "EARLY", qty: 20, expiryDate: new Date("2026-08-01") });
    const doc = await makeRequest(50);

    const res = mockRes();
    await ctrl.accept({ params: { id: doc._id }, body: {}, user: opsUser() }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const fresh = await TransferRequest.findById(doc._id);
    expect(fresh.status).toBe("accepted");
    expect(fresh.shipmentId).toBeTruthy();

    const ship = await Shipment.findById(fresh.shipmentId);
    expect(ship.status).toBe("planned");
    expect(String(ship.fromWarehouseId)).toBe(String(source._id));
    expect(String(ship.toWarehouseId)).toBe(String(requester._id));
    expect(ship.lines.reduce((s, l) => s + l.qty, 0)).toBe(50);
    // FEFO: EARLY (20) fully used, LATE covers the remaining 30
    const byLot = Object.fromEntries(ship.lines.map((l) => [l.batchNumber, l.qty]));
    expect(byLot.EARLY).toBe(20);
    expect(byLot.LATE).toBe(30);
  });

  test("company_admin cannot accept — accepting creates a transfer (view-only)", async () => {
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: source._id, batchNumber: "L1", qty: 100 });
    const doc = await makeRequest(10);

    const res = mockRes();
    await ctrl.accept({ params: { id: doc._id }, body: {}, user: adminUser() }, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/transfer between warehouses/i);
    const fresh = await TransferRequest.findById(doc._id);
    expect(fresh.status).toBe("requested"); // untouched
    expect(await Shipment.countDocuments({ companyId })).toBe(0); // nothing created
  });

  test("dispatch is blocked when the transfer would overflow the destination warehouse", async () => {
    // destination has a small capacity, already near-full
    await Warehouse.updateOne({ _id: requester._id }, { $set: { capacityUnits: 100 } });
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: requester._id, batchNumber: "DEST", qty: 80 });
    // source lot to send
    const srcLot = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: source._id, batchNumber: "SRC", qty: 50 });

    const ship = await shipmentService.createShipment(companyId, {
      toLabel: "Katni", toType: "warehouse", fromWarehouseId: source._id, toWarehouseId: requester._id,
      lines: [{ inventoryId: srcLot._id, qty: 40 }], // 80 + 40 = 120 > 100
    });
    await expect(
      shipmentService.dispatchShipment(companyId, ship._id, { performedBy: new mongoose.Types.ObjectId() }),
    ).rejects.toMatchObject({ status: 409 });
    // source stock untouched — the guard ran before any deduction
    expect((await Inventory.findById(srcLot._id)).availableStock).toBe(50);
  });

  test("a second in-transit transfer cannot collectively overflow the destination", async () => {
    await Warehouse.updateOne({ _id: requester._id }, { $set: { capacityUnits: 100 } });
    const srcLot = await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: source._id, batchNumber: "SRC", qty: 200 });
    const perf = new mongoose.Types.ObjectId();

    // First transfer of 60 dispatches fine (dest is empty).
    const shipA = await shipmentService.createShipment(companyId, {
      toLabel: "Katni", toType: "warehouse", fromWarehouseId: source._id, toWarehouseId: requester._id,
      lines: [{ inventoryId: srcLot._id, qty: 60 }],
    });
    await shipmentService.dispatchShipment(companyId, shipA._id, { performedBy: perf });

    // Second transfer of 60: dest occupancy is still 0 (nothing received yet),
    // but 60 is already in-transit toward it, so 60 + 60 > 100 → blocked.
    const shipB = await shipmentService.createShipment(companyId, {
      toLabel: "Katni", toType: "warehouse", fromWarehouseId: source._id, toWarehouseId: requester._id,
      lines: [{ inventoryId: srcLot._id, qty: 60 }],
    });
    await expect(
      shipmentService.dispatchShipment(companyId, shipB._id, { performedBy: perf }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("a scoped manager of ANOTHER warehouse cannot accept", async () => {
    const User = require("../model/User/User");
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: source._id, batchNumber: "L1", qty: 100 });
    const other = await User.create({ companyId, name: "Raj", role: "operations_manager", warehouseIds: [requester._id], status: "active" });
    const doc = await makeRequest(10);

    const res = mockRes();
    await ctrl.accept({ params: { id: doc._id }, body: {}, user: { id: other._id, companyId, role: "operations_manager" } }, res);
    expect(res.statusCode).toBe(403);
  });
});

describe("transfer-request list — Transfer Ref. column", () => {
  const { shipmentRef } = require("../services/shipmentService");

  test("an unfulfilled request has transferRef null (UI shows 'Not created')", async () => {
    await makeRequest(10);

    const res = mockRes();
    await ctrl.list({ query: {}, user: adminUser() }, res);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].transferRef).toBeNull();
  });

  test("an accepted request exposes the SAME ref its shipment shows in Transfer History", async () => {
    await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: source._id, batchNumber: "L1", qty: 100 });
    const doc = await makeRequest(10);
    await ctrl.accept({ params: { id: doc._id }, body: {}, user: opsUser() }, mockRes());

    const res = mockRes();
    await ctrl.list({ query: {}, user: adminUser() }, res);

    const row = res.body.data.find((r) => String(r._id) === String(doc._id));
    const ship = await Shipment.findById((await TransferRequest.findById(doc._id)).shipmentId);
    // The reference derives from the linked shipment, never guessed or built
    // from status text — identical to what Transfer History renders.
    expect(row.transferRef).toBe(shipmentRef(ship));
    expect(row.transferRef).toMatch(/^SH-[0-9A-F]{6}$/);
  });

  test("existing populated fields are untouched (additive change only)", async () => {
    await makeRequest(10);
    const res = mockRes();
    await ctrl.list({ query: {}, user: adminUser() }, res);
    const row = res.body.data[0];
    expect(row.productId?.productName).toBeTruthy();
    expect(row.fromWarehouseId?.name).toBeTruthy();
    expect(row.toWarehouseId?.name).toBeTruthy();
    expect(row.status).toBe("requested");
  });
});
