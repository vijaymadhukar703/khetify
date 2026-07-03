const Order = require("../model/Order/Order");
const Package = require("../model/Outbound/Package");
const Shipment = require("../model/Transport/Shipment");
const UnitSerial = require("../model/Barcode/UnitSerial");
const lotService = require("./lotService");
const barcodeService = require("./barcodeService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Dispatch an order: this is the moment stock physically leaves the building.
 *   1. commit the FEFO allocations (reserved → sold) per line
 *   2. transition the order's packed serials → shipped (link order/customer)
 *   3. create a Shipment and mark the order shipped
 *
 * (Sprint 5 extends Shipment with vehicles/drivers/route/POD; here we create a
 * basic shipment record so the transport board has something to track.)
 */
async function dispatch(companyId, { orderId, vehicleNo, driverName, driverPhone, transporter, toLabel, fromWarehouseId, performedBy }) {
  const order = await Order.findOne({ _id: orderId, companyId });
  if (!order) throw httpErr("Order not found", 404);
  if (order.status === "shipped" || order.status === "delivered") throw httpErr(`Order already ${order.status}`, 409);

  const hasAllocations = (order.items || []).some((it) => (it.allocations || []).length);
  if (hasAllocations) {
    for (const it of order.items || []) {
      if (!it.allocations?.length) continue;
      await lotService.commitAllocation({ ownerId: companyId, allocations: it.allocations, channel: order.channel || "offline", refId: order._id, performedBy });
    }
    order.markModified("items");
  } else {
    // Legacy order without reservations — deduct FEFO now.
    for (const it of order.items || []) {
      await lotService.sellFEFO({ ownerId: companyId, productId: it.productId, qty: it.qty, channel: order.channel || "offline", refId: order._id, performedBy });
    }
  }

  const shipment = await Shipment.create({
    companyId,
    refType: "Order",
    refId: order._id,
    fromWarehouseId: fromWarehouseId || null,
    toLabel: toLabel || order.customerName || "Customer",
    vehicleNo, driverName, driverPhone, transporter,
    status: "in_transit",
    dispatchedAt: new Date(),
    notes: `Dispatch for ${order.invoiceNumber || order.orderNumber}`,
  });

  // Transition packed serials → shipped, linking order + customer for trace.
  const pkgs = await Package.find({ companyId, orderId });
  const serials = pkgs.flatMap((p) => p.items.flatMap((i) => i.serials || []));
  if (serials.length) {
    await barcodeService.transitionUnits(companyId, serials, {
      toStatus: "shipped", event: "shipped", refType: "Shipment", refId: shipment._id,
      actorId: performedBy, set: { orderId: order._id, customerId: order.customerId, currentShipmentId: shipment._id }, force: true,
    });
    await Package.updateMany({ companyId, orderId }, { $set: { status: "shipped", shipmentId: shipment._id } });
  }

  order.status = "shipped";
  order.dispatchedAt = new Date();
  await order.save();

  return { shipment, order: { _id: order._id, status: order.status, invoiceNumber: order.invoiceNumber } };
}

// Seller SUPPLY orders are dispatched via the supply controller, which finalizes
// a planned shipment (created at label time) through shipmentService.dispatchShipment.

module.exports = { dispatch };
