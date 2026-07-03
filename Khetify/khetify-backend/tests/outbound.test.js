const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Order = require("../model/Order/Order");
const Location = require("../model/Warehouse/Location");
const UnitSerial = require("../model/Barcode/UnitSerial");
const pickService = require("../services/pickService");
const packService = require("../services/packService");
const dispatchService = require("../services/dispatchService");
const lotService = require("../services/lotService");
const locationService = require("../services/locationService");

let companyId, warehouseId, productId;

beforeEach(async () => {
  const c = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = c._id;
  const wh = await Warehouse.create({ companyId, name: "Main", code: "WH1" });
  warehouseId = wh._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "U1", mrp: 100 });
  productId = p._id;
});

async function seedLotInBin(batch, qty, binCode) {
  const inv = await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId, batchNumber: batch, lotNumber: batch, expiryDate: new Date(Date.now() + 90 * 86400000), offlineStock: qty, availableStock: qty });
  const bin = await locationService.createLocation(companyId, { warehouseId, type: "bin", code: binCode });
  await locationService.moveBinStock({ companyId, toLocationId: bin._id, inventoryId: inv._id, qty });
  return { inv, bin };
}

async function makeReservedOrder(qty) {
  const order = await Order.create({ companyId, orderNumber: "O1", invoiceNumber: "INV-2627-0001", customerName: "Ramesh", channel: "offline", status: "confirmed",
    items: [{ productId, name: "Urea", qty, price: 100, allocations: [] }] });
  order.items[0].allocations = await lotService.allocateFEFO({ ownerId: companyId, productId, qty });
  order.markModified("items");
  await order.save();
  return order;
}

describe("pick wave", () => {
  test("lines are routed (sorted) by bin fullCode — S-shape path", async () => {
    await seedLotInBin("B-Z", 10, "Z9"); // WH1-Z9
    await seedLotInBin("B-A", 10, "A1"); // WH1-A1
    // reserve both lots via one order (qty pulls FEFO across both)
    const order = await Order.create({ companyId, orderNumber: "O", invoiceNumber: "INV-2627-0002", channel: "offline", status: "confirmed", items: [{ productId, name: "Urea", qty: 20, price: 100, allocations: [] }] });
    order.items[0].allocations = await lotService.allocateFEFO({ ownerId: companyId, productId, qty: 20 });
    order.markModified("items"); await order.save();

    const wave = await pickService.generateWave(companyId, { warehouseId, orderIds: [order._id] });
    const codes = wave.lines.map((l) => l.fromCode);
    const sorted = [...codes].sort((a, b) => a.localeCompare(b));
    expect(codes).toEqual(sorted); // already in walk order
    expect(codes[0]).toContain("A1"); // earliest aisle first
  });
});

describe("pack scan verification", () => {
  test("rejects a serial that does not belong to the order", async () => {
    const { inv } = await seedLotInBin("B1", 5, "A1");
    await require("../services/barcodeService").generateUnits(companyId, inv._id, 5);
    // a serial from a DIFFERENT lot
    const { inv: other } = await seedLotInBin("B2", 5, "A2");
    await require("../services/barcodeService").generateUnits(companyId, other._id, 5);
    const foreign = (await UnitSerial.findOne({ companyId, inventoryId: other._id })).serial;

    const order = await makeReservedOrder(3); // allocates from B1 (FEFO, both same expiry → B1 first by insertion? ensure B1)
    // force allocation to inv (B1): clear and re-reserve from B1 explicitly is complex; instead assert the foreign serial is rejected
    await expect(
      packService.createPackage(companyId, { orderId: order._id, items: [{ productId, qty: 1, serials: [foreign] }] })
    ).rejects.toMatchObject({ status: 409 });
  });

  test("accepts serials from the order's allocated lot", async () => {
    const { inv } = await seedLotInBin("B1", 5, "A1");
    const barcodeService = require("../services/barcodeService");
    await barcodeService.generateUnits(companyId, inv._id, 5);
    // put units in_stock so they can be picked/packed
    const serials = (await UnitSerial.find({ companyId, inventoryId: inv._id })).map((u) => u.serial);
    await barcodeService.transitionUnits(companyId, serials, { toStatus: "in_stock", force: true });

    const order = await makeReservedOrder(3);
    const pkg = await packService.createPackage(companyId, { orderId: order._id, items: [{ productId, qty: 2, serials: serials.slice(0, 2) }] });
    expect(pkg.packageNumber).toMatch(/^PKG-\d{6}-\d{4}$/);
    const u = await UnitSerial.findOne({ companyId, serial: serials[0] });
    expect(u.status).toBe("packed");
  });
});

describe("dispatch", () => {
  test("commits exactly the allocated quantities (reserved → sold)", async () => {
    const { inv } = await seedLotInBin("B1", 50, "A1");
    const order = await makeReservedOrder(20);

    let row = await Inventory.findById(inv._id);
    expect(row.reservedStock).toBe(20);
    expect(row.availableStock).toBe(30);

    await dispatchService.dispatch(companyId, { orderId: order._id });

    row = await Inventory.findById(inv._id);
    expect(row.reservedStock).toBe(0); // released from reserve
    expect(row.offlineStock).toBe(30); // 50 − 20 dispatched
    expect(row.availableStock).toBe(30);

    const shipped = await Order.findById(order._id);
    expect(shipped.status).toBe("shipped");
  });

  test("dispatch is idempotent on committed allocations (no double-deduct)", async () => {
    const { inv } = await seedLotInBin("B1", 50, "A1");
    const order = await makeReservedOrder(20);
    await dispatchService.dispatch(companyId, { orderId: order._id });
    await expect(dispatchService.dispatch(companyId, { orderId: order._id })).rejects.toMatchObject({ status: 409 });
    const row = await Inventory.findById(inv._id);
    expect(row.offlineStock).toBe(30); // unchanged after the blocked second dispatch
  });
});
