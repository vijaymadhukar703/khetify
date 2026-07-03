const mongoose = require("mongoose");
require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Seller = require("../model/Seller/Seller");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const User = require("../model/User/User");
const TransferRequest = require("../model/Transport/TransferRequest");
const transferCtrl = require("../controller/Seller/sellerTransferController");
const shipmentCtrl = require("../controller/Seller/sellerShipmentController");
const sellerTransferService = require("../services/sellerTransferService");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyId, sellerId, productId, whA, whB, srcMgr, destMgr;
// req shapes for a scoped manager (warehouseScope reads the live User doc).
const asUser = (u, { params = {}, body = {}, query = {} } = {}) => ({ user: { id: u._id, sellerId, principalType: "seller", role: "seller_manager" }, params, body, query });
const asAdmin = ({ params = {}, body = {}, query = {} } = {}) => ({ user: { id: sellerId, sellerId, principalType: "seller", role: "seller_admin" }, params, body, query });

beforeEach(async () => {
  companyId = new mongoose.Types.ObjectId();
  sellerId = (await Seller.create({ email: `s-${new mongoose.Types.ObjectId()}@x.com`, passwordHash: "x", status: "active", linkStatus: "approved", sellerInfo: { businessName: "S" } }))._id;
  productId = (await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 100 }))._id;
  whA = await Warehouse.create({ sellerId, name: "WH-A (source)" });
  whB = await Warehouse.create({ sellerId, name: "WH-B (dest)" });
  await Inventory.create({ productId, ownerType: "seller", ownerId: sellerId, warehouseId: whA._id, batchNumber: "A1", lotNumber: "A1", offlineStock: 50, availableStock: 50 });
  srcMgr = await User.create({ ownerType: "seller", ownerId: sellerId, name: "Src", role: "seller_manager", status: "active", warehouseIds: [whA._id] });
  destMgr = await User.create({ ownerType: "seller", ownerId: sellerId, name: "Dest", role: "seller_manager", status: "active", warehouseIds: [whB._id] });
});

// Create a fresh push request A→B (initiated by the source side).
async function newRequest() {
  const { doc } = await sellerTransferService.createRequest({
    sellerId, fromWarehouseId: whA._id, toWarehouseId: whB._id, productId, qty: 20,
    requestedBy: srcMgr._id, scope: [String(whA._id)], // source manager initiates
  });
  return doc;
}

describe("seller transfer PUSH roles: destination decides, source dispatches, destination receives", () => {
  test("DESTINATION (not source) accepts/rejects the request", async () => {
    const doc = await newRequest();

    // the SOURCE manager cannot accept its own push request
    const srcTry = mockRes();
    await transferCtrl.acceptTransfer(asUser(srcMgr, { params: { id: doc._id } }), srcTry);
    expect(srcTry.statusCode).toBe(403);
    expect(srcTry.body.message).toMatch(/destination warehouse/i);
    expect((await TransferRequest.findById(doc._id)).status).toBe("requested"); // unchanged

    // the DESTINATION manager accepts → shipment created
    const destOk = mockRes();
    await transferCtrl.acceptTransfer(asUser(destMgr, { params: { id: doc._id } }), destOk);
    expect(destOk.body.success).toBe(true);
    const tr = await TransferRequest.findById(doc._id);
    expect(tr.status).toBe("accepted");
    expect(tr.shipmentId).toBeTruthy();
  });

  test("SOURCE dispatches (destination can't); DESTINATION receives (source can't)", async () => {
    const doc = await newRequest();
    // accept via admin to get a shipment without role-gating noise
    await transferCtrl.acceptTransfer(asAdmin({ params: { id: doc._id } }), mockRes());
    const shipId = String((await TransferRequest.findById(doc._id)).shipmentId);

    // DISPATCH — destination cannot, source can
    const destDispatch = mockRes();
    await shipmentCtrl.dispatch(asUser(destMgr, { params: { id: shipId } }), destDispatch);
    expect(destDispatch.statusCode).toBe(403);

    const srcDispatch = mockRes();
    await shipmentCtrl.dispatch(asUser(srcMgr, { params: { id: shipId }, body: { labelPrinted: true } }), srcDispatch);
    expect(srcDispatch.body.data.status).toBe("in_transit");
    const qr = srcDispatch.body.data.qrPayload;
    expect(qr).toBeTruthy();

    // RECEIVE — source cannot, destination can
    const srcReceive = mockRes();
    await shipmentCtrl.receive(asUser(srcMgr, { params: { id: shipId }, body: { qr } }), srcReceive);
    expect(srcReceive.statusCode).toBe(403);

    const destReceive = mockRes();
    await shipmentCtrl.receive(asUser(destMgr, { params: { id: shipId }, body: { qr } }), destReceive);
    expect(destReceive.body.success).toBe(true);

    expect((await TransferRequest.findById(doc._id)).status).toBe("fulfilled");
    const bStock = await Inventory.find({ ownerType: "seller", ownerId: sellerId, warehouseId: whB._id });
    expect(bStock.reduce((s, r) => s + r.availableStock, 0)).toBe(20); // landed in destination
  });

  test("seller-scoped: a manager of ANOTHER seller cannot decide this seller's request", async () => {
    const doc = await newRequest();
    const otherSeller = await Seller.create({ email: `o-${new mongoose.Types.ObjectId()}@x.com`, passwordHash: "x", status: "active", linkStatus: "approved", sellerInfo: { businessName: "Other" } });
    const res = mockRes();
    // a different seller principal → the request isn't in their owner scope → 404
    await transferCtrl.acceptTransfer({ user: { id: otherSeller._id, sellerId: otherSeller._id, principalType: "seller", role: "seller_admin" }, params: { id: doc._id }, body: {} }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("seller transfer PULL roles: holder decides + dispatches, requester receives", () => {
  // The requester (whB) asks the HOLDER (whA, which has 50) for stock INTO whB.
  async function newPull() {
    const { doc } = await sellerTransferService.createRequest({
      sellerId, fromWarehouseId: whA._id, toWarehouseId: whB._id, productId, qty: 20,
      requestedBy: destMgr._id, scope: [String(whB._id)], mode: "pull", // requester owns the destination
    });
    return doc;
  }

  test("the HOLDER (source) — not the requester — accepts the pull request", async () => {
    const doc = await newPull();
    expect(doc.mode).toBe("pull");

    // the REQUESTER (destMgr, whB) cannot accept its own pull request
    const reqTry = mockRes();
    await transferCtrl.acceptTransfer(asUser(destMgr, { params: { id: doc._id } }), reqTry);
    expect(reqTry.statusCode).toBe(403);
    expect(reqTry.body.message).toMatch(/holding warehouse/i);

    // the HOLDER (srcMgr, whA) accepts → shipment created
    const holderOk = mockRes();
    await transferCtrl.acceptTransfer(asUser(srcMgr, { params: { id: doc._id } }), holderOk);
    expect(holderOk.body.success).toBe(true);
    expect((await TransferRequest.findById(doc._id)).status).toBe("accepted");
  });

  test("HOLDER dispatches (requester can't); REQUESTER receives (holder can't)", async () => {
    const doc = await newPull();
    await transferCtrl.acceptTransfer(asAdmin({ params: { id: doc._id } }), mockRes());
    const shipId = String((await TransferRequest.findById(doc._id)).shipmentId);

    // DISPATCH — requester can't, holder can
    const reqDisp = mockRes();
    await shipmentCtrl.dispatch(asUser(destMgr, { params: { id: shipId } }), reqDisp);
    expect(reqDisp.statusCode).toBe(403);
    const holderDisp = mockRes();
    await shipmentCtrl.dispatch(asUser(srcMgr, { params: { id: shipId }, body: { labelPrinted: true } }), holderDisp);
    expect(holderDisp.body.data.status).toBe("in_transit");
    const qr = holderDisp.body.data.qrPayload;

    // RECEIVE — holder can't, requester can
    const holderRecv = mockRes();
    await shipmentCtrl.receive(asUser(srcMgr, { params: { id: shipId }, body: { qr } }), holderRecv);
    expect(holderRecv.statusCode).toBe(403);
    const reqRecv = mockRes();
    await shipmentCtrl.receive(asUser(destMgr, { params: { id: shipId }, body: { qr } }), reqRecv);
    expect(reqRecv.body.success).toBe(true);

    expect((await TransferRequest.findById(doc._id)).status).toBe("fulfilled");
    const bStock = await Inventory.find({ ownerType: "seller", ownerId: sellerId, warehouseId: whB._id });
    expect(bStock.reduce((s, r) => s + r.availableStock, 0)).toBe(20); // landed in the requester whB
  });

  test("a manager can only request stock INTO their assigned warehouse", async () => {
    // srcMgr (whA) tries to pull INTO whB (not theirs) → 403
    await expect(sellerTransferService.createRequest({
      sellerId, fromWarehouseId: whB._id, toWarehouseId: whA._id, productId, qty: 5,
      requestedBy: srcMgr._id, scope: [String(whB._id)], mode: "pull",
    })).rejects.toThrow(/into your assigned/i);
  });
});
