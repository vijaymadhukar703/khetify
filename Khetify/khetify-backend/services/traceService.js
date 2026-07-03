const UnitSerial = require("../model/Barcode/UnitSerial");
const UnitEvent = require("../model/Barcode/UnitEvent");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const Order = require("../model/Order/Order");
const Customer = require("../model/Sales/Customer");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Full journey of a single unit: serial → events → order → customer. */
async function traceSerial(companyId, serial) {
  const unit = await UnitSerial.findOne({ companyId, serial })
    .populate("productId", "productName skuNumber")
    .populate("currentLocationId", "fullCode")
    .populate("currentShipmentId", "status toLabel");
  if (!unit) throw httpErr("Serial not found", 404);

  const events = await UnitEvent.find({ companyId, serial }).sort({ at: 1 });
  const order = unit.orderId ? await Order.findOne({ _id: unit.orderId, companyId }).select("orderNumber invoiceNumber status placedAt customerName customerId") : null;
  const customer = unit.customerId ? await Customer.findOne({ _id: unit.customerId, companyId }).select("name phone customerCode") : null;

  return { unit, events, order, customer };
}

/** Lot trace: stock rows, the full quantity ledger, and every customer reached. */
async function traceLot(companyId, lotNumber) {
  const invRows = await Inventory.find({ ownerId: companyId, ownerType: "company", $or: [{ lotNumber }, { batchNumber: lotNumber }] })
    .populate("productId", "productName skuNumber")
    .populate("warehouseId", "name code");
  if (!invRows.length) throw httpErr("Lot not found", 404);

  const invIds = invRows.map((r) => r._id);
  const movements = await StockMovement.find({ inventoryId: { $in: invIds } }).sort({ createdAt: 1 }).limit(1000);

  // orders that allocated this lot
  const orders = await Order.find({ companyId, "items.allocations.lotNumber": lotNumber })
    .select("orderNumber invoiceNumber customerName customerId status placedAt")
    .sort({ placedAt: -1 });

  // unit status breakdown
  const unitAgg = await UnitSerial.aggregate([
    { $match: { companyId: invRows[0].companyId, lotNumber } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const units = Object.fromEntries(unitAgg.map((u) => [u._id, u.count]));

  return { lotNumber, stock: invRows, movements, ordersReached: orders, units };
}

/** Find an order by invoice number (for the trace search box). */
async function traceInvoice(companyId, invoiceNumber) {
  const order = await Order.findOne({ companyId, invoiceNumber })
    .populate("customerId", "name phone customerCode gstin");
  if (!order) throw httpErr("Invoice not found", 404);
  return { order };
}

/* ---------------- seller (owner-aware) traceability ---------------- */

/** Full journey of one of the SELLER's units: serial → events. */
async function traceSellerSerial(sellerId, serial) {
  const unit = await UnitSerial.findOne({ ownerType: "seller", ownerId: sellerId, serial })
    .populate("productId", "productName skuNumber")
    .populate("currentLocationId", "fullCode")
    .populate("currentShipmentId", "status toLabel");
  if (!unit) throw httpErr("Serial not found", 404);
  // Events are keyed by serial (the unit may have started life under a company
  // before being supplied to the seller); the serial is the stable identity.
  const events = await UnitEvent.find({ serial }).sort({ at: 1 });
  return { unit, events };
}

/** Lot trace for the SELLER: stock rows + the full quantity ledger + unit mix. */
async function traceSellerLot(sellerId, lotNumber) {
  const invRows = await Inventory.find({ ownerId: sellerId, ownerType: "seller", $or: [{ lotNumber }, { batchNumber: lotNumber }] })
    .populate("productId", "productName skuNumber")
    .populate("warehouseId", "name code");
  if (!invRows.length) throw httpErr("Lot not found", 404);

  const invIds = invRows.map((r) => r._id);
  const movements = await StockMovement.find({ inventoryId: { $in: invIds } }).sort({ createdAt: 1 }).limit(1000);
  const unitAgg = await UnitSerial.aggregate([
    { $match: { ownerType: "seller", ownerId: invRows[0].ownerId, lotNumber } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const units = Object.fromEntries(unitAgg.map((u) => [u._id, u.count]));
  return { lotNumber, stock: invRows, movements, units };
}

module.exports = { traceSerial, traceLot, traceInvoice, traceSellerSerial, traceSellerLot };
