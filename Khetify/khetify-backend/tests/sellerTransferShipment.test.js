const mongoose = require("mongoose");
require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Seller = require("../model/Seller/Seller");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const Shipment = require("../model/Transport/Shipment");
const TransferRequest = require("../model/Transport/TransferRequest");
const transferCtrl = require("../controller/Seller/sellerTransferController");
const shipmentCtrl = require("../controller/Seller/sellerShipmentController");
const traceService = require("../services/traceService");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyId, sellerId, productId, whA, whB;
const adminReq = (extra = {}) => ({ user: { id: sellerId, sellerId, principalType: "seller", role: "seller_admin" }, body: {}, params: {}, query: {}, ...extra });
const inv = (r) => r.onlineStock + r.offlineStock - r.reservedStock;

beforeEach(async () => {
  companyId = new mongoose.Types.ObjectId();
  sellerId = (await Seller.create({ email: `s-${new mongoose.Types.ObjectId()}@x.com`, passwordHash: "x", status: "active", linkStatus: "approved", sellerInfo: { businessName: "S" } }))._id;
  productId = (await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 100 }))._id;
  whA = await Warehouse.create({ sellerId, name: "WH-A" });
  whB = await Warehouse.create({ sellerId, name: "WH-B" });
  // FEFO: lot L1 (50, expires sooner), lot L2 (50, later) in WH-A.
  await Inventory.create({ productId, ownerType: "seller", ownerId: sellerId, warehouseId: whA._id, batchNumber: "L1", lotNumber: "L1", offlineStock: 50, availableStock: 50, expiryDate: new Date("2026-06-01") });
  await Inventory.create({ productId, ownerType: "seller", ownerId: sellerId, warehouseId: whA._id, batchNumber: "L2", lotNumber: "L2", offlineStock: 50, availableStock: 50, expiryDate: new Date("2027-06-01") });
});

describe("PART A — seller transfer rides the full shipment lifecycle", () => {
  test("request → accept (planned shipment, FEFO) → dispatch (in_transit) → scan-receive (lands in B)", async () => {
    // 1) REQUEST A→B for 60 units (spans both lots FEFO)
    const reqRes = mockRes();
    await transferCtrl.createTransfer(adminReq({ body: { fromWarehouseId: whA._id, toWarehouseId: whB._id, productId, qty: 60 } }), reqRes);
    expect(reqRes.statusCode).toBe(201);
    const trId = reqRes.body.data._id;
    expect(reqRes.body.data.status).toBe("requested");

    // 2) ACCEPT → planned shipment created, FEFO lines (L1 fully, L2 remainder)
    const accRes = mockRes();
    await transferCtrl.acceptTransfer(adminReq({ params: { id: trId } }), accRes);
    expect(accRes.body.success).toBe(true);
    const tr = await TransferRequest.findById(trId);
    expect(tr.status).toBe("accepted");
    expect(tr.shipmentId).toBeTruthy();
    const ship = await Shipment.findById(tr.shipmentId);
    expect(ship.status).toBe("planned");
    expect(ship.ownerType).toBe("seller");
    expect(String(ship.ownerId)).toBe(String(sellerId));
    expect(ship.companyId).toBeFalsy();           // no company on a seller transfer
    expect(ship.lines.length).toBe(2);            // FEFO across L1 + L2
    const l1 = ship.lines.find((l) => l.lotNumber === "L1");
    expect(l1.qty).toBe(50);                       // soonest-expiry lot drained first

    // 3) DISPATCH → stock leaves A (in_transit), qr returned
    const dispRes = mockRes();
    await shipmentCtrl.dispatch(adminReq({ params: { id: String(tr.shipmentId) }, body: { labelPrinted: true } }), dispRes);
    expect(dispRes.body.data.status).toBe("in_transit");
    const qr = dispRes.body.data.qrPayload;
    expect(qr).toBeTruthy();
    const aAfter = await Inventory.find({ ownerType: "seller", ownerId: sellerId, warehouseId: whA._id });
    expect(aAfter.reduce((s, r) => s + r.availableStock, 0)).toBe(40); // 100 - 60 left in A
    aAfter.forEach((r) => expect(r.availableStock).toBe(inv(r)));      // invariant holds

    // ledger transfer_out written
    const outMoves = await StockMovement.find({ ownerType: "seller", ownerId: sellerId, type: "in_transit_out" });
    expect(outMoves.reduce((s, m) => s + Math.abs(m.quantity), 0)).toBe(60);

    // 4) SCAN-RECEIVE at B
    const recvRes = mockRes();
    await shipmentCtrl.receive(adminReq({ params: { id: String(tr.shipmentId) }, body: { qr } }), recvRes);
    expect(recvRes.body.success).toBe(true);

    const bRows = await Inventory.find({ ownerType: "seller", ownerId: sellerId, warehouseId: whB._id });
    expect(bRows.reduce((s, r) => s + r.availableStock, 0)).toBe(60); // landed in B
    bRows.forEach((r) => expect(r.availableStock).toBe(inv(r)));      // invariant holds
    const inMoves = await StockMovement.find({ ownerType: "seller", ownerId: sellerId, type: "in_transit_in" });
    expect(inMoves.reduce((s, m) => s + m.quantity, 0)).toBe(60);

    const fulfilled = await TransferRequest.findById(trId);
    expect(fulfilled.status).toBe("fulfilled");
    const shipFinal = await Shipment.findById(tr.shipmentId);
    expect(shipFinal.status).toBe("received");
  });

  test("accept is short-circuited (409) when the source lacks stock; request stays pending", async () => {
    const reqRes = mockRes();
    await transferCtrl.createTransfer(adminReq({ body: { fromWarehouseId: whA._id, toWarehouseId: whB._id, productId, qty: 500 } }), reqRes);
    const trId = reqRes.body.data._id;
    const accRes = mockRes();
    await transferCtrl.acceptTransfer(adminReq({ params: { id: trId } }), accRes);
    expect(accRes.statusCode).toBe(409);
    expect(accRes.body.data.available).toBe(100);
    expect((await TransferRequest.findById(trId)).status).toBe("requested"); // unchanged
  });
});

describe("seller shipments + trace are owner-scoped", () => {
  test("seller shipments list shows only the seller's shipments (no company rows)", async () => {
    // a company shipment that must NOT leak into the seller's list
    await Shipment.create({ companyId, ownerType: "company", ownerId: companyId, toType: "warehouse", toLabel: "Co WH", status: "planned" });
    // a seller shipment
    const reqRes = mockRes();
    await transferCtrl.createTransfer(adminReq({ body: { fromWarehouseId: whA._id, toWarehouseId: whB._id, productId, qty: 10 } }), reqRes);
    await transferCtrl.acceptTransfer(adminReq({ params: { id: reqRes.body.data._id } }), mockRes());

    const listRes = mockRes();
    await shipmentCtrl.list(adminReq(), listRes);
    expect(listRes.body.count).toBe(1);
    expect(listRes.body.data.every((s) => s.ownerType === "seller")).toBe(true);
  });

  test("traceSellerLot returns the seller lot's stock + ledger", async () => {
    const data = await traceService.traceSellerLot(sellerId, "L1");
    expect(data.lotNumber).toBe("L1");
    expect(data.stock.length).toBe(1);
    expect(data.stock[0].warehouseId.name).toBe("WH-A");
  });
});

describe("Send Stock: accepted transfer is dispatchable only after the label is printed", () => {
  async function acceptedShipment() {
    const reqRes = mockRes();
    await transferCtrl.createTransfer(adminReq({ body: { fromWarehouseId: whA._id, toWarehouseId: whB._id, productId, qty: 30 } }), reqRes);
    await transferCtrl.acceptTransfer(adminReq({ params: { id: reqRes.body.data._id } }), mockRes());
    const tr = await TransferRequest.findById(reqRes.body.data._id);
    return { trId: tr._id, shipId: String(tr.shipmentId) };
  }

  test("the accepted (planned) shipment is listed in Send Stock for the source", async () => {
    const { shipId } = await acceptedShipment();
    const listRes = mockRes();
    await shipmentCtrl.list(adminReq(), listRes);
    const row = listRes.body.data.find((s) => String(s._id) === shipId);
    expect(row).toBeTruthy();
    expect(row.status).toBe("planned"); // ready to fulfil in Send Stock
  });

  test("dispatch is BLOCKED until the label is printed; then it goes in_transit and the dest can receive", async () => {
    const { trId, shipId } = await acceptedShipment();

    // dispatch WITHOUT printing the label → 409, still planned
    const noLabel = mockRes();
    await shipmentCtrl.dispatch(adminReq({ params: { id: shipId } }), noLabel);
    expect(noLabel.statusCode).toBe(409);
    expect(noLabel.body.message).toMatch(/print the shipping label/i);
    expect((await Shipment.findById(shipId)).status).toBe("planned");

    // print the label (manifest) → returns a scannable QR, no dispatch yet
    const manRes = mockRes();
    await shipmentCtrl.manifest(adminReq({ params: { id: shipId } }), manRes);
    const qr = manRes.body.data.qrPayload;
    expect(qr).toMatch(new RegExp(`^${shipId}\\.`));
    expect((await Shipment.findById(shipId)).status).toBe("planned"); // printing ≠ dispatch

    // now dispatch with labelPrinted → in_transit, stock leaves source
    const disp = mockRes();
    await shipmentCtrl.dispatch(adminReq({ params: { id: shipId }, body: { labelPrinted: true } }), disp);
    expect(disp.body.data.status).toBe("in_transit");
    const aLeft = await Inventory.find({ ownerType: "seller", ownerId: sellerId, warehouseId: whA._id });
    expect(aLeft.reduce((s, r) => s + r.availableStock, 0)).toBe(70); // 100 - 30

    // destination scans the printed label to receive → lands in B, fulfilled
    const recv = mockRes();
    await shipmentCtrl.receive(adminReq({ params: { id: shipId }, body: { qr } }), recv);
    expect(recv.body.success).toBe(true);
    const bRows = await Inventory.find({ ownerType: "seller", ownerId: sellerId, warehouseId: whB._id });
    expect(bRows.reduce((s, r) => s + r.availableStock, 0)).toBe(30);
    expect((await TransferRequest.findById(trId)).status).toBe("fulfilled");
  });
});

describe("Send Stock three-tab pipeline: Pick → Pack → Dispatch (mirrors company)", () => {
  async function accepted(qty) {
    const reqRes = mockRes();
    await transferCtrl.createTransfer(adminReq({ body: { fromWarehouseId: whA._id, toWarehouseId: whB._id, productId, qty } }), reqRes);
    await transferCtrl.acceptTransfer(adminReq({ params: { id: reqRes.body.data._id } }), mockRes());
    const tr = await TransferRequest.findById(reqRes.body.data._id);
    return { trId: tr._id, shipId: String(tr.shipmentId) };
  }

  test("cannot pack until fully picked; cannot dispatch until label printed; flow lands stock", async () => {
    const { trId, shipId } = await accepted(60); // FEFO: L1(50) + L2(10) => two lines
    const s = await Shipment.findById(shipId);
    expect(s.status).toBe("planned"); // waiting in the Pick tab
    expect(s.lines.length).toBe(2);

    // PACK before any pick → blocked
    const earlyPack = mockRes();
    await shipmentCtrl.pack(adminReq({ params: { id: shipId } }), earlyPack);
    expect(earlyPack.statusCode).toBe(409);

    // PICK only line 0 → "picking", still can't pack (requested qty not met)
    const p1 = mockRes();
    await shipmentCtrl.pick(adminReq({ params: { id: shipId }, body: { picks: [{ lineIndex: 0, qty: 50 }] } }), p1);
    expect(p1.body.data.status).toBe("picking");
    const midPack = mockRes();
    await shipmentCtrl.pack(adminReq({ params: { id: shipId } }), midPack);
    expect(midPack.statusCode).toBe(409);

    // PICK the remaining line → fully "picked"
    const p2 = mockRes();
    await shipmentCtrl.pick(adminReq({ params: { id: shipId }, body: { picks: [{ lineIndex: 1, qty: 10 }] } }), p2);
    expect(p2.body.data.status).toBe("picked");

    // PACK → "packed"
    const packRes = mockRes();
    await shipmentCtrl.pack(adminReq({ params: { id: shipId } }), packRes);
    expect(packRes.body.data.status).toBe("packed");

    // DISPATCH without the label → blocked
    const noLabel = mockRes();
    await shipmentCtrl.dispatch(adminReq({ params: { id: shipId } }), noLabel);
    expect(noLabel.statusCode).toBe(409);

    // Print the label, then dispatch → in_transit; stock leaves the source.
    await shipmentCtrl.manifest(adminReq({ params: { id: shipId } }), mockRes());
    const disp = mockRes();
    await shipmentCtrl.dispatch(adminReq({ params: { id: shipId }, body: { labelPrinted: true } }), disp);
    expect(disp.body.data.status).toBe("in_transit");
    const aLeft = await Inventory.find({ ownerType: "seller", ownerId: sellerId, warehouseId: whA._id });
    expect(aLeft.reduce((acc, r) => acc + r.availableStock, 0)).toBe(40); // 100 - 60

    // Destination scan-receives → lands in B, request fulfilled.
    const recv = mockRes();
    await shipmentCtrl.receive(adminReq({ params: { id: shipId }, body: { qr: disp.body.data.qrPayload } }), recv);
    expect(recv.body.success).toBe(true);
    const bRows = await Inventory.find({ ownerType: "seller", ownerId: sellerId, warehouseId: whB._id });
    expect(bRows.reduce((acc, r) => acc + r.availableStock, 0)).toBe(60);
    expect((await TransferRequest.findById(trId)).status).toBe("fulfilled");
  });

  test("scan-to-pick: scanned serials count toward the line and complete the pick", async () => {
    const { shipId } = await accepted(30); // single FEFO line of 30 from L1
    const pick = mockRes();
    await shipmentCtrl.pick(adminReq({ params: { id: shipId }, body: { picks: [{ lineIndex: 0, serials: Array.from({ length: 30 }, (_, i) => `U-${i}`) }] } }), pick);
    expect(pick.body.data.status).toBe("picked");
    expect(pick.body.data.lines[0].pickedQty).toBe(30);
    expect(pick.body.data.lines[0].serials.length).toBe(30);
  });
});
