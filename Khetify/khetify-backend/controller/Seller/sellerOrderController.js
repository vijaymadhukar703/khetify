const Order = require("../../model/Order/Order");
const Inventory = require("../../model/Inventory/Inventory");
const UnitSerial = require("../../model/Barcode/UnitSerial");
const Shipment = require("../../model/Transport/Shipment");
const lotService = require("../../services/lotService");
const salesService = require("../../services/salesService");
const barcodeService = require("../../services/barcodeService");
const shipmentService = require("../../services/shipmentService");

// Same workflow map the company order controller uses.
const TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["returned"],
  returned: [],
  cancelled: [],
};

const sellerOwner = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });
const sellerScope = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });
const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/** POST /api/seller/orders — create a confirmed sale order (FEFO reservation from seller stock). */
exports.createOrder = async (req, res) => {
  try {
    const order = await salesService.createOrder(sellerOwner(req), { ...req.body, performedBy: req.user.sellerId });
    res.status(201).json({ success: true, message: `Order created · ${order.invoiceNumber}`, data: order });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/orders */
exports.getOrders = async (req, res) => {
  try {
    const filter = sellerScope(req);
    if (req.query.status) filter.status = req.query.status;
    const rows = await Order.find(filter).sort({ placedAt: -1 }).limit(Math.min(Number(req.query.limit) || 200, 500));
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/orders/:id */
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, ...sellerScope(req) }).lean();
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    order.nextStates = TRANSITIONS[order.status] || [];
    res.json({ success: true, data: order });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/orders/:id/picklist — FEFO plan over the SELLER's lots. */
exports.getPicklist = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, ...sellerScope(req) });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    const now = new Date();
    const lines = [];
    for (const it of order.items || []) {
      const lots = await Inventory.find({
        productId: it.productId, ownerType: "seller", ownerId: req.user.sellerId,
        availableStock: { $gt: 0 }, $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
      }).populate("warehouseId", "name").sort({ expiryDate: 1 });
      let remaining = it.qty;
      const picks = [];
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(lot.availableStock, remaining);
        remaining -= take;
        picks.push({ lotNumber: lot.lotNumber || lot.batchNumber, batchNumber: lot.batchNumber, warehouse: lot.warehouseId?.name || "Unassigned", take });
      }
      lines.push({ name: it.name, qty: it.qty, shortfall: Math.max(0, remaining), picks });
    }
    res.json({ success: true, data: { orderNumber: order.orderNumber, lines } });
  } catch (err) { fail(res, err); }
};

/**
 * PATCH /api/seller/orders/:id/status — drive the workflow.
 * On "shipped": commit reserved seller stock (or FEFO fallback) AND close the
 * traceability chain — the seller's units for the sold lots become "sold",
 * linked to the buyer. On "cancelled": release reserved stock.
 */
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const sellerId = req.user.sellerId;
    const order = await Order.findOne({ _id: req.params.id, ownerType: "seller", ownerId: sellerId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const allowed = TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Cannot move an order from "${order.status}" to "${status}".` });
    }

    const hasAllocations = (order.items || []).some((it) => (it.allocations || []).length > 0);

    if (status === "shipped") {
      // The ONE place stock leaves for a sale (commit reservation or FEFO),
      // shared with the warehouse dispatch flow — so deduction can never double.
      await shipOrderStock(order, sellerId);
    }

    if (status === "cancelled" && hasAllocations) {
      for (const it of order.items || []) {
        if (!it.allocations?.length) continue;
        await lotService.releaseAllocation({ ownerType: "seller", ownerId: sellerId, allocations: it.allocations, refId: order._id, performedBy: sellerId });
      }
      order.markModified("items");
    }

    order.status = status;
    if (status === "shipped") order.dispatchedAt = new Date();
    await order.save();

    // On confirm, create the customer Shipment so the order rides the SAME
    // warehouse pick → pack → label-gated dispatch pipeline as supply/transfers
    // (it then shows in Operations → Send Stock → Pick). Non-fatal.
    if (status === "confirmed") {
      try { await ensureOrderShipment(order, sellerId); }
      catch (e) { console.error("order shipment create:", e.message); }
    }

    const out = order.toObject();
    out.nextStates = TRANSITIONS[order.status] || [];
    res.json({ success: true, message: `Order marked ${status}`, data: out });
  } catch (err) { fail(res, err); }
};

/**
 * Transition the seller's units for each committed allocation to "sold", linking
 * the order + customer, so a scan of that unit traces company → seller → buyer.
 */
async function markUnitsSold(order, sellerId) {
  const serials = [];
  for (const it of order.items || []) {
    for (const a of it.allocations || []) {
      const lotFilter = a.inventoryId
        ? { inventoryId: a.inventoryId }
        : { lotNumber: a.lotNumber };
      const units = await UnitSerial.find({
        ownerType: "seller", ownerId: sellerId, ...lotFilter,
        status: { $in: ["in_stock", "printed", "generated"] },
      }).limit(a.qty || 0).select("serial");
      serials.push(...units.map((u) => u.serial));
    }
  }
  if (!serials.length) return;
  await barcodeService.transitionUnits(
    { ownerType: "seller", ownerId: sellerId },
    serials,
    { toStatus: "sold", event: "sold", refType: "Order", refId: order._id, set: { orderId: order._id, customerId: order.customerId }, force: true }
  );
}

/**
 * The single sale-deduction path: commit the order's FEFO reservations (or
 * deduct FEFO if it was never reserved) and mark its units sold. Called from the
 * status flow AND the warehouse dispatch flow — and from THERE ONLY — so an
 * order's stock can be deducted exactly once no matter which path ships it.
 */
async function shipOrderStock(order, sellerId) {
  const channel = order.channel || "offline";
  const hasAllocations = (order.items || []).some((it) => (it.allocations || []).length > 0);
  if (hasAllocations) {
    for (const it of order.items || []) {
      if (!it.allocations?.length) continue;
      await lotService.commitAllocation({ ownerType: "seller", ownerId: sellerId, allocations: it.allocations, channel, refId: order._id, performedBy: sellerId });
    }
    order.markModified("items");
  } else {
    for (const it of order.items || []) {
      await lotService.sellFEFO({ ownerType: "seller", ownerId: sellerId, productId: it.productId, qty: it.qty, channel, refId: order._id, performedBy: sellerId });
    }
  }
  await markUnitsSold(order, sellerId);
}

/** FEFO pick plan → shipment lines (one per lot drawn), with the holding
 *  warehouse, so the order rides the real shipment pick/pack pipeline. Does NOT
 *  move stock — that happens once at dispatch via shipOrderStock. */
async function buildOrderShipmentLines(order, sellerId) {
  const now = new Date();
  const lines = [];
  for (const it of order.items || []) {
    const lots = await Inventory.find({
      productId: it.productId, ownerType: "seller", ownerId: sellerId,
      availableStock: { $gt: 0 }, $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
    }).sort({ expiryDate: 1 });
    let remaining = it.qty;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.availableStock, remaining);
      remaining -= take;
      lines.push({ inventoryId: lot._id, productId: it.productId, lotNumber: lot.lotNumber || lot.batchNumber, batchNumber: lot.batchNumber, qty: take, _warehouseId: lot.warehouseId || null });
    }
  }
  return lines;
}

/** Find the live customer shipment already created for this order, if any. */
async function findOrderShipment(orderId, sellerId) {
  return Shipment.findOne({
    refType: "Order", refId: orderId, ownerType: "seller", ownerId: sellerId,
    status: { $in: ["planned", "approved", "picking", "picked", "packed"] },
  });
}

/**
 * Idempotently create the customer Shipment for a confirmed order so it enters
 * the warehouse Send-Stock pipeline (Pick → Pack → label-gated Dispatch). The
 * shipment is `toType:"customer"`, so dispatching it moves NO stock — the sale
 * deduction happens exactly once via shipOrderStock when the order ships.
 */
async function ensureOrderShipment(order, sellerId) {
  const existing = await findOrderShipment(order._id, sellerId);
  if (existing) return existing;
  const built = await buildOrderShipmentLines(order, sellerId);
  if (!built.length) return null; // no stock yet — nothing to fulfil
  const fromWarehouseId = built[0]._warehouseId || null;
  const lines = built.map(({ _warehouseId, ...l }) => l); // strip helper field
  return shipmentService.createShipment(
    { ownerType: "seller", ownerId: sellerId },
    { refType: "Order", refId: order._id, toType: "customer", toLabel: order.customerName || "Customer", fromWarehouseId, lines, performedBy: sellerId }
  );
}

/** Hook: shipment PACKED → sync the order to "packed" (for the customer tracker). */
exports.markOrderPacked = async (orderId, sellerId) => {
  const order = await Order.findOne({ _id: orderId, ownerType: "seller", ownerId: sellerId });
  if (order && order.status === "confirmed") { order.status = "packed"; await order.save(); }
};

/** Hook: shipment DISPATCHED → ship the order. This is the ONE sale-deduction
 *  (the shipment moved no stock, being toType "customer"). Idempotent. */
exports.shipOrder = async (orderId, sellerId) => {
  const order = await Order.findOne({ _id: orderId, ownerType: "seller", ownerId: sellerId });
  if (!order || ["shipped", "delivered", "cancelled", "returned"].includes(order.status)) return;
  await shipOrderStock(order, sellerId);
  order.status = "shipped";
  order.dispatchedAt = new Date();
  await order.save();
};
