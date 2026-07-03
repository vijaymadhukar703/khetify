const mongoose = require("mongoose");
require("../model/Company/Company");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Customer = require("../model/Sales/Customer");
const Seller = require("../model/Seller/Seller");
const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const Order = require("../model/Order/Order");
const salesService = require("../services/salesService");
const barcodeService = require("../services/barcodeService");
const lotService = require("../services/lotService");
const sellerOrders = require("../controller/Seller/sellerOrderController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const invSum = (r) => (r.onlineStock || 0) + (r.offlineStock || 0) - (r.reservedStock || 0);

let companyId, productId, companyWh, sellerId, sellerWh, sellerCust, sellerLot;

beforeEach(async () => {
  const c = await Company.create({ fullName: "Supplier", email: `s-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: "Supplier Co" } });
  companyId = c._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 270, gstPercentage: 5 });
  productId = p._id;
  companyWh = await Warehouse.create({ companyId, name: "Co WH" });

  const seller = await Seller.create({ passwordHash: "x", sellerInfo: { businessName: "Krishna" }, supplyingCompanyId: companyId, linkStatus: "approved", status: "active" });
  sellerId = seller._id;
  sellerWh = await Warehouse.create({ sellerId, name: "Seller WH" });
  sellerCust = await Customer.create({ ownerType: "seller", ownerId: sellerId, name: "Ramesh Dealer", type: "dealer", phone: "9000000001" });

  // company lot + label 5 units, then supply 5 to the seller (units travel)
  const coLot = await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id, batchNumber: "L1", lotNumber: "L1", expiryDate: new Date("2027-01-01"), offlineStock: 10, availableStock: 10 });
  await barcodeService.generateUnits(companyId, coLot._id, 5);
  await lotService.supplyTransfer({ companyId, sellerId, sourceWarehouseId: companyWh._id, destWarehouseId: sellerWh._id, items: [{ productId, quantity: 5 }], refId: new mongoose.Types.ObjectId(), performedBy: sellerId });
  sellerLot = await Inventory.findOne({ ownerType: "seller", ownerId: sellerId, batchNumber: "L1" });
});

const asSeller = (body = {}, params = {}, query = {}) => ({ user: { sellerId, principalType: "seller", role: "seller_admin" }, body, params, query });

describe("seller outbound: FEFO reserves SELLER stock only", () => {
  test("creating a seller order reserves from seller stock (reserved up, available down)", async () => {
    const res = mockRes();
    await sellerOrders.createOrder(asSeller({ customerId: sellerCust._id, items: [{ productId, qty: 3 }] }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.ownerType).toBe("seller");
    expect(res.body.data.invoiceNumber).toMatch(/^INV-/);

    const sLot = await Inventory.findOne({ _id: sellerLot._id });
    expect(sLot.reservedStock).toBe(3);
    expect(sLot.availableStock).toBe(2); // 5 − 3 reserved
    expect(invSum(sLot)).toBe(sLot.availableStock);

    // company stock for the same product untouched by the seller's reservation
    const coLot = await Inventory.findOne({ ownerType: "company", ownerId: companyId, batchNumber: "L1" });
    expect(coLot.reservedStock || 0).toBe(0);
  });

  test("a company order still reserves only company stock (no ownerType → unchanged)", async () => {
    await Customer.create({ ownerType: "company", ownerId: companyId, companyId, name: "Co Cust", phone: "9333333333" });
    // give the company a separate available lot
    await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: companyWh._id, batchNumber: "C2", lotNumber: "C2", offlineStock: 4, availableStock: 4 });
    const order = await salesService.createOrder({ ownerType: "company", ownerId: companyId }, { items: [{ productId, qty: 2 }] });
    expect(order.ownerType).toBe("company");
    // seller stock untouched
    const sLot = await Inventory.findOne({ _id: sellerLot._id });
    expect(sLot.reservedStock || 0).toBe(0);
  });
});

describe("seller ship closes the chain (stock + units sold)", () => {
  test("on ship: seller stock commits AND seller units become sold with buyer linked", async () => {
    const create = mockRes();
    await sellerOrders.createOrder(asSeller({ customerId: sellerCust._id, items: [{ productId, qty: 3 }] }), create);
    const orderId = create.body.data._id;

    // confirmed → packed → shipped
    await sellerOrders.updateStatus(asSeller({ status: "packed" }, { id: orderId }), mockRes());
    const shipRes = mockRes();
    await sellerOrders.updateStatus(asSeller({ status: "shipped" }, { id: orderId }), shipRes);
    expect(shipRes.body.data.status).toBe("shipped");
    expect(shipRes.body.data.dispatchedAt).toBeTruthy();

    // seller stock deducted (3 of 5 gone), reservation cleared
    const sLot = await Inventory.findOne({ _id: sellerLot._id });
    expect(sLot.availableStock).toBe(2);
    expect(sLot.reservedStock || 0).toBe(0);
    expect(invSum(sLot)).toBe(sLot.availableStock);

    // exactly 3 seller units are now "sold", linked to the order + customer
    const sold = await UnitSerial.find({ ownerType: "seller", ownerId: sellerId, status: "sold" });
    expect(sold.length).toBe(3);
    expect(sold.every((u) => String(u.orderId) === String(orderId))).toBe(true);
    expect(sold.every((u) => String(u.customerId) === String(sellerCust._id))).toBe(true);

    // a "sold" UnitEvent was logged (chain: company → seller → customer)
    const events = await UnitEvent.find({ event: "sold", refType: "Order", refId: orderId });
    expect(events.length).toBe(3);
  });

  test("a company recall of the lot still reaches the now-sold seller units", async () => {
    const create = mockRes();
    await sellerOrders.createOrder(asSeller({ customerId: sellerCust._id, items: [{ productId, qty: 2 }] }), create);
    const orderId = create.body.data._id;
    await sellerOrders.updateStatus(asSeller({ status: "packed" }, { id: orderId }), mockRes());
    await sellerOrders.updateStatus(asSeller({ status: "shipped" }, { id: orderId }), mockRes());

    // sold units are NOT recalled (already sold), but the company recall reaches all units of the lot
    const r = await barcodeService.recall(companyId, "L1", { performedBy: companyId });
    expect(r.recalledUnits).toBe(3); // 5 supplied − 2 sold = 3 recallable
    expect(r.soldUnits).toBe(2);     // the 2 sold seller units are surfaced
  });
});

describe("seller cancel releases reserved stock", () => {
  test("cancel returns reserved → available; no units sold", async () => {
    const create = mockRes();
    await sellerOrders.createOrder(asSeller({ customerId: sellerCust._id, items: [{ productId, qty: 4 }] }), create);
    const orderId = create.body.data._id;

    let sLot = await Inventory.findOne({ _id: sellerLot._id });
    expect(sLot.reservedStock).toBe(4);

    await sellerOrders.updateStatus(asSeller({ status: "cancelled" }, { id: orderId }), mockRes());
    sLot = await Inventory.findOne({ _id: sellerLot._id });
    expect(sLot.reservedStock || 0).toBe(0);
    expect(sLot.availableStock).toBe(5); // fully released
    expect(await UnitSerial.countDocuments({ ownerType: "seller", ownerId: sellerId, status: "sold" })).toBe(0);
  });
});
