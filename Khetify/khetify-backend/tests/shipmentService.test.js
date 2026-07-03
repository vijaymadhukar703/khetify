const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const svc = require("../services/shipmentService");
const { withinGeofence } = require("../services/geoService");
const notificationService = require("../services/notificationService");

let companyId, srcWh, destWh, productId, inv;
const driverId = new mongoose.Types.ObjectId();

// Dispatch fires a best-effort "Incoming transfer" heads-up to the destination
// warehouse team. Stub it so tests don't depend on the notification transport.
beforeEach(() => {
  jest.spyOn(notificationService, "notifyWarehouseTeam").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  const c = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = c._id;
  // dest warehouse with a geofence at a known point
  srcWh = await Warehouse.create({ companyId, name: "Source", code: "WH1" });
  destWh = await Warehouse.create({ companyId, name: "Dest", code: "WH2", location: { type: "Point", coordinates: [79.0, 23.0] }, geofenceRadiusM: 300 });
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "U1" });
  productId = p._id;
  inv = await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: srcWh._id, batchNumber: "B1", lotNumber: "B1", offlineStock: 100, availableStock: 100 });
});

async function makeTransfer(qty = 40) {
  return svc.createShipment(companyId, {
    refType: "Transfer", toType: "warehouse", fromWarehouseId: srcWh._id, toWarehouseId: destWh._id,
    toLabel: "Dest", driverId, lines: [{ inventoryId: inv._id, qty }],
  });
}

describe("geofence helper", () => {
  test("inside radius passes, far away fails", () => {
    // ~0m from the warehouse point
    expect(withinGeofence(destWh, 23.0, 79.0).ok).toBe(true);
    // ~150km away
    expect(withinGeofence(destWh, 24.5, 79.0).ok).toBe(false);
  });
});

describe("transfer in-transit accounting", () => {
  test("dispatch deducts source; verified receipt lands at destination (no double-count)", async () => {
    const ship = await makeTransfer(40);
    const { otp, qrPayload } = await svc.dispatchShipment(companyId, ship._id, {});
    expect(otp).toBeUndefined(); // OTP mechanism removed — dispatch returns only the manifest
    expect(qrPayload).toMatch(new RegExp(`^${ship._id}\\.`));

    // source dropped by 40, in-transit (no dest row yet)
    let src = await Inventory.findById(inv._id);
    expect(src.availableStock).toBe(60);
    let destRow = await Inventory.findOne({ ownerId: companyId, warehouseId: destWh._id, productId });
    expect(destRow).toBeNull();

    // verify receipt inside the geofence, by a DIFFERENT user than the driver,
    // with the manifest barcode, at the destination warehouse — no code needed
    const r = await svc.verifyReceipt(companyId, ship._id, { verifierId: new mongoose.Types.ObjectId(), qr: qrPayload, warehouseId: destWh._id, lat: 23.0, lng: 79.0 });
    expect(r.shipment.status).toBe("received");
    expect(r.shipment.pod.method).toBe("scan");
    expect(String(r.shipment.pod.warehouseId)).toBe(String(destWh._id));
    expect(r.shipment.pod.verifiedBy).toBeTruthy();
    expect(r.shipment.pod.verifiedAt).toBeTruthy();

    destRow = await Inventory.findOne({ ownerId: companyId, warehouseId: destWh._id, productId });
    expect(destRow.availableStock).toBe(40); // landed in full
    src = await Inventory.findById(inv._id);
    expect(src.availableStock).toBe(60); // unchanged — not double counted
  });

  test("a short receipt creates a discrepancy and marks partially_received", async () => {
    const ship = await makeTransfer(40);
    const { qrPayload } = await svc.dispatchShipment(companyId, ship._id, {});
    const r = await svc.verifyReceipt(companyId, ship._id, { verifierId: new mongoose.Types.ObjectId(), qr: qrPayload, lat: 23.0, lng: 79.0, lines: [{ lineIndex: 0, receivedQty: 35 }] });
    expect(r.shortages).toBe(1);
    expect(r.shipment.status).toBe("partially_received");
    const destRow = await Inventory.findOne({ ownerId: companyId, warehouseId: destWh._id, productId });
    expect(destRow.availableStock).toBe(35); // only what arrived
  });
});

describe("verification controls", () => {
  test("scan + correct warehouse is sufficient to receive (no code)", async () => {
    const ship = await makeTransfer(10);
    const { qrPayload } = await svc.dispatchShipment(companyId, ship._id, {});
    const r = await svc.verifyReceipt(companyId, ship._id, { verifierId: new mongoose.Types.ObjectId(), qr: qrPayload, warehouseId: destWh._id, lat: 23.0, lng: 79.0 });
    expect(r.shipment.status).toBe("received");
    expect(r.shipment.pod.method).toBe("scan");
    const destRow = await Inventory.findOne({ ownerId: companyId, warehouseId: destWh._id, productId });
    expect(destRow.availableStock).toBe(10);
  });

  test("driver cannot verify their own delivery", async () => {
    const ship = await makeTransfer(10);
    const { qrPayload } = await svc.dispatchShipment(companyId, ship._id, {});
    await expect(
      svc.verifyReceipt(companyId, ship._id, { verifierId: driverId, qr: qrPayload, lat: 23.0, lng: 79.0 })
    ).rejects.toMatchObject({ status: 403 });
  });

  test("a wrong manifest QR is rejected", async () => {
    const ship = await makeTransfer(10);
    await svc.dispatchShipment(companyId, ship._id, {});
    await expect(
      svc.verifyReceipt(companyId, ship._id, { verifierId: new mongoose.Types.ObjectId(), qr: "bogus", lat: 23.0, lng: 79.0 })
    ).rejects.toMatchObject({ status: 409 });
  });

  test("warehouse scope: a manager assigned to ANOTHER warehouse cannot receive", async () => {
    const ship = await makeTransfer(10);
    const { qrPayload } = await svc.dispatchShipment(companyId, ship._id, {});
    // verifier is scoped to the SOURCE warehouse only → access denied
    await expect(
      svc.verifyReceipt(companyId, ship._id, {
        verifierId: new mongoose.Types.ObjectId(), qr: qrPayload,
        allowedWarehouseIds: [String(srcWh._id)], lat: 23.0, lng: 79.0,
      })
    ).rejects.toMatchObject({ status: 403 });
    // verifier scoped to the DESTINATION succeeds
    const r = await svc.verifyReceipt(companyId, ship._id, {
      verifierId: new mongoose.Types.ObjectId(), qr: qrPayload,
      allowedWarehouseIds: [String(destWh._id)], lat: 23.0, lng: 79.0,
    });
    expect(r.shipment.status).toBe("received");
  });

  test("lifecycle: planned → approved → dispatched, with user/warehouse on every event", async () => {
    const ship = await makeTransfer(5);
    const approver = new mongoose.Types.ObjectId();
    const approved = await svc.approveShipment(companyId, ship._id, { performedBy: approver });
    expect(approved.status).toBe("approved");
    const { shipment } = await svc.dispatchShipment(companyId, ship._id, { performedBy: approver });
    expect(shipment.status).toBe("in_transit");
    const events = shipment.statusHistory.map((e) => e.status);
    expect(events).toEqual(expect.arrayContaining(["planned", "approved", "in_transit"]));
    const approvedEvt = shipment.statusHistory.find((e) => e.status === "approved");
    expect(String(approvedEvt.byUserId)).toBe(String(approver));
    expect(String(approvedEvt.warehouseId)).toBe(String(srcWh._id));
  });

  test("the source warehouse cannot complete the receipt", async () => {
    const ship = await makeTransfer(10);
    const { qrPayload } = await svc.dispatchShipment(companyId, ship._id, {});
    await expect(
      svc.verifyReceipt(companyId, ship._id, { verifierId: new mongoose.Types.ObjectId(), qr: qrPayload, warehouseId: srcWh._id, lat: 23.0, lng: 79.0 })
    ).rejects.toMatchObject({ status: 403 });
  });

  test("verification outside the geofence is rejected", async () => {
    const ship = await makeTransfer(10);
    const { qrPayload } = await svc.dispatchShipment(companyId, ship._id, {});
    await expect(
      svc.verifyReceipt(companyId, ship._id, { verifierId: new mongoose.Types.ObjectId(), qr: qrPayload, lat: 24.5, lng: 79.0 })
    ).rejects.toMatchObject({ status: 409 });
  });

  test("customer delivery needs a proof-of-delivery (signed-by / photo)", async () => {
    const ship = await svc.createShipment(companyId, { refType: "Manual", toType: "customer", toLabel: "Ramesh" });
    await svc.dispatchShipment(companyId, ship._id, {});
    // no POD → rejected
    await expect(
      svc.completeDelivery(companyId, ship._id, { verifierId: new mongoose.Types.ObjectId() })
    ).rejects.toMatchObject({ status: 409 });
    // signed-by name → delivered
    const s = await svc.completeDelivery(companyId, ship._id, { verifierId: new mongoose.Types.ObjectId(), signedBy: "Ramesh" });
    expect(s.status).toBe("delivered");
    expect(s.pod.method).toBe("scan");
    expect(s.pod.signedBy).toBe("Ramesh");
  });
});
