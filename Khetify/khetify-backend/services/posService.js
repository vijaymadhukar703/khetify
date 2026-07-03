const Customer = require("../model/Sales/Customer");
const Order = require("../model/Order/Order");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const StockMovement = require("../model/Inventory/StockMovement");
const IdempotencyRecord = require("../model/Integration/IdempotencyRecord");
const { withTransaction } = require("./txn");
const customerService = require("./customerService");
const barcodeService = require("./barcodeService");
const outbox = require("./outboxService");

/** Resolve the warehouse for a POS line by explicit id or store code. */
async function resolveWarehouse(companyId, item) {
  if (item.warehouseId) return Warehouse.findOne({ _id: item.warehouseId, companyId });
  if (item.storeCode) return Warehouse.findOne({ companyId, code: item.storeCode });
  return null;
}

/** FEFO-deduct one product's qty from a specific warehouse, inside a session. */
async function deductFEFO(session, { companyId, productId, warehouseId, qty, refId }) {
  const now = new Date();
  const lots = await Inventory.find({
    productId, ownerType: "company", ownerId: companyId, warehouseId,
    availableStock: { $gt: 0 }, $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
  }).sort({ expiryDate: 1 }).session(session);
  const total = lots.reduce((s, l) => s + l.availableStock, 0);
  if (total < qty) { const e = new Error(`INSUFFICIENT_STOCK for product (have ${total}, need ${qty})`); e.status = 409; throw e; }

  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.availableStock, remaining);
    const inv = await Inventory.findOneAndUpdate(
      { _id: lot._id, availableStock: { $gte: take } },
      { $inc: { offlineStock: -take, availableStock: -take } },
      { new: true, session }
    );
    if (!inv) continue;
    remaining -= take;
    await StockMovement.create([{ inventoryId: inv._id, productId, ownerType: "company", ownerId: companyId, type: "sale_offline", channel: "offline", quantity: -take, balanceAfter: inv.availableStock, refType: "Order", refId, note: "POS sale" }], { session });
  }
  if (remaining > 0) { const e = new Error("CONCURRENT_STOCK_CHANGE — retry"); e.status = 409; throw e; }
}

/** Process ONE POS sale (its own transaction). Returns a per-item result. */
async function processSale(companyId, item) {
  // Idempotency: replay returns the stored result.
  const existing = await IdempotencyRecord.findOne({ companyId, key: item.externalId });
  if (existing) return { externalId: item.externalId, ok: true, replay: true, ...existing.response };

  const warehouse = await resolveWarehouse(companyId, item);
  if (!warehouse) return { externalId: item.externalId, ok: false, error: "Unknown store / warehouse" };

  // Upsert customer by phone (outside the stock txn).
  let customer = null;
  if (item.customer?.phone) {
    customer = await Customer.findOne({ companyId, phone: item.customer.phone });
    if (!customer) customer = await customerService.createCustomer(companyId, { name: item.customer.name || "POS Customer", phone: item.customer.phone, type: "retail" });
  }

  // Resolve products + prices.
  const lines = [];
  for (const l of item.lines || []) {
    const product = await Product.findOne({ companyId, skuNumber: l.sku });
    if (!product) return { externalId: item.externalId, ok: false, error: `Unknown SKU ${l.sku}` };
    lines.push({ productId: product._id, name: product.productName, qty: Number(l.qty), price: l.price != null ? Number(l.price) : (product.mrp || 0), serials: l.serials || [] });
  }
  if (!lines.length) return { externalId: item.externalId, ok: false, error: "No lines" };

  let orderId;
  try {
    orderId = await withTransaction(async (session) => {
      for (const line of lines) {
        await deductFEFO(session, { companyId, productId: line.productId, warehouseId: warehouse._id, qty: line.qty, refId: null });
      }
      const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
      const totalAmount = lines.reduce((s, l) => s + l.qty * l.price, 0);
      const [order] = await Order.create([{
        companyId, orderNumber: `POS-${item.externalId}`, customerId: customer?._id || null, customerName: customer?.name,
        items: lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.price })),
        totalUnits, totalAmount, channel: "offline", salesChannel: "pos", status: "delivered",
        payment: { mode: item.payment?.mode, status: "paid" }, placedAt: item.soldAt ? new Date(item.soldAt) : new Date(),
      }], { session });
      await IdempotencyRecord.create([{ companyId, key: item.externalId, response: { orderId: order._id } }], { session });
      return order._id;
    });
  } catch (err) {
    if (err.code === 11000) { // idempotency race — another worker processed it
      const rec = await IdempotencyRecord.findOne({ companyId, key: item.externalId });
      return { externalId: item.externalId, ok: true, replay: true, ...(rec?.response || {}) };
    }
    return { externalId: item.externalId, ok: false, error: err.message };
  }

  // Post-commit side-effects: serials sold + outbound events.
  const allSerials = lines.flatMap((l) => l.serials);
  if (allSerials.length) {
    try { await barcodeService.transitionUnits(companyId, allSerials, { toStatus: "sold", event: "sold", refType: "Order", refId: orderId, set: { orderId, customerId: customer?._id }, force: true }); } catch { /* best-effort */ }
  }
  await outbox.emit(companyId, "order.created", { orderId, channel: "pos", externalId: item.externalId }).catch(() => {});
  await outbox.emit(companyId, "inventory.updated", { warehouseId: warehouse._id }).catch(() => {});

  return { externalId: item.externalId, ok: true, orderId };
}

/** Sync a batch of POS sales. Never all-or-nothing — one result per item. */
async function syncSales(companyId, batch = []) {
  const results = [];
  for (const item of batch) {
    if (!item.externalId) { results.push({ ok: false, error: "externalId is required" }); continue; }
    try { results.push(await processSale(companyId, item)); }
    catch (err) { results.push({ externalId: item.externalId, ok: false, error: err.message }); }
  }
  return results;
}

module.exports = { syncSales, processSale };
