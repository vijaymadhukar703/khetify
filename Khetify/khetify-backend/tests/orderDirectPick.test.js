const mongoose = require("mongoose");
require("../model/Company/Company");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const UnitSerial = require("../model/Barcode/UnitSerial");
const Order = require("../model/Order/Order");
const barcodeService = require("../services/barcodeService");
const lotService = require("../services/lotService");
const pickService = require("../services/pickService");

const invSum = (r) => (r.onlineStock || 0) + (r.offlineStock || 0) - (r.reservedStock || 0);

let companyId, productId, wh, lot, serials;

beforeEach(async () => {
  const c = await Company.create({ fullName: "Co", email: `c-${new mongoose.Types.ObjectId()}@x.com`, password: "x", status: "approved", companyInfo: { companyName: "Co" } });
  companyId = c._id;
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR", mrp: 270 });
  productId = p._id;
  wh = await Warehouse.create({ companyId, name: "WH", code: "WH1" });
  lot = await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: wh._id, batchNumber: "L1", lotNumber: "L1", offlineStock: 10, availableStock: 10 });
  await barcodeService.generateUnits(companyId, lot._id, 5);
  serials = (await UnitSerial.find({ ownerId: companyId, inventoryId: lot._id }).sort({ serial: 1 })).map((u) => u.serial);
  await barcodeService.transitionUnits(companyId, serials, { toStatus: "in_stock", event: "in_stock", force: true });
});

async function confirmedOrder(qty = 3) {
  const order = await Order.create({ companyId, orderNumber: "O-1", invoiceNumber: "INV-1", customerName: "Ramesh", channel: "offline", status: "confirmed", items: [{ productId, name: "Urea", qty, price: 100, allocations: [] }] });
  order.items[0].allocations = await lotService.allocateFEFO({ ownerId: companyId, productId, qty });
  order.markModified("items");
  await order.save();
  return order;
}

describe("direct order pick (no wave/PickList)", () => {
  test("scanned units in_stock → picked, pickedQty tracked, owned stock NOT deducted", async () => {
    const order = await confirmedOrder(3);
    const take = serials.slice(0, 3);

    const updated = await pickService.pickOrderDirect(companyId, order._id, { picks: [{ productId, serials: take }], performedBy: companyId });
    expect(updated.items[0].pickedQty).toBe(3);

    const picked = await UnitSerial.find({ ownerId: companyId, status: "picked" });
    expect(picked.length).toBe(3);

    // reservation intact, nothing deducted from owned stock yet
    const co = await Inventory.findById(lot._id);
    expect(co.reservedStock).toBe(3);
    expect(co.offlineStock).toBe(10);
    expect(co.availableStock).toBe(7);
    expect(invSum(co)).toBe(co.availableStock);
  });

  test("rejects a serial that isn't from the order's reserved lots", async () => {
    const order = await confirmedOrder(3);
    // a unit from a different lot
    const other = await Inventory.create({ productId, ownerType: "company", ownerId: companyId, warehouseId: wh._id, batchNumber: "L2", lotNumber: "L2", offlineStock: 2, availableStock: 2 });
    await barcodeService.generateUnits(companyId, other._id, 1);
    const stray = (await UnitSerial.find({ ownerId: companyId, inventoryId: other._id }))[0].serial;
    await barcodeService.transitionUnits(companyId, [stray], { toStatus: "in_stock", event: "in_stock", force: true });

    await expect(pickService.pickOrderDirect(companyId, order._id, { picks: [{ productId, serials: [stray] }], performedBy: companyId }))
      .rejects.toMatchObject({ status: 409 });
  });
});
