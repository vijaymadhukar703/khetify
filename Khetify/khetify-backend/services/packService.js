const Package = require("../model/Outbound/Package");
const Order = require("../model/Order/Order");
const UnitSerial = require("../model/Barcode/UnitSerial");
const { nextSeq } = require("./counterService");
const barcodeService = require("./barcodeService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function nextPackageNumber(companyId) {
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const seq = await nextSeq(companyId, `pkg-${period}`);
  return `PKG-${period}-${String(seq).padStart(4, "0")}`;
}

/** Set of inventoryIds this order allocated (for serial verification). */
function allocatedInventoryIds(order) {
  const ids = new Set();
  for (const it of order.items || []) for (const a of it.allocations || []) ids.add(String(a.inventoryId));
  return ids;
}

/**
 * Pack an order into a carton. Each scanned serial is verified to belong to the
 * order's allocation (else 409). Serials transition picked → packed.
 */
async function createPackage(companyId, { orderId, items = [], weightKg, dims, performedBy }) {
  const order = await Order.findOne({ _id: orderId, companyId });
  if (!order) throw httpErr("Order not found", 404);
  if (!items.length) throw httpErr("A package needs at least one item");

  const allowedInv = allocatedInventoryIds(order);
  const allSerials = items.flatMap((i) => i.serials || []);

  if (allSerials.length) {
    const units = await UnitSerial.find({ companyId, serial: { $in: allSerials } });
    const bySerial = new Map(units.map((u) => [u.serial, u]));
    for (const s of allSerials) {
      const u = bySerial.get(s);
      if (!u) throw httpErr(`Unknown serial ${s}`, 409);
      if (!allowedInv.has(String(u.inventoryId))) throw httpErr(`Serial ${s} does not belong to this order`, 409);
      if (!["picked", "in_stock"].includes(u.status)) throw httpErr(`Serial ${s} is ${u.status}, cannot pack`, 409);
    }
    await barcodeService.transitionUnits(companyId, allSerials, { toStatus: "packed", event: "packed", refType: "Order", refId: order._id, actorId: performedBy, force: true });
  }

  const packageNumber = await nextPackageNumber(companyId);
  const pkg = await Package.create({
    companyId,
    orderId,
    packageNumber,
    items: items.map((i) => ({ productId: i.productId, qty: Number(i.qty), serials: i.serials || [] })),
    weightKg,
    dims,
    packedBy: performedBy,
    status: "packed",
  });

  // Mark the order packed (workflow convenience).
  if (order.status === "confirmed") { order.status = "packed"; await order.save(); }
  return pkg;
}

async function listPackages(companyId, { orderId } = {}) {
  const filter = { companyId };
  if (orderId) filter.orderId = orderId;
  return Package.find(filter).populate("items.productId", "productName skuNumber").sort({ createdAt: -1 });
}

module.exports = { createPackage, listPackages };
