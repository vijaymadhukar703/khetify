const mongoose = require("mongoose");
const ProductCost = require("../model/Costing/ProductCost");
const ShipmentCost = require("../model/Transport/ShipmentCost");
const Inventory = require("../model/Inventory/Inventory");
const Order = require("../model/Order/Order");
const { publish } = require("./eventBus");

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const err = (m, s = 400) => { const e = new Error(m); e.status = s; return e; };

/* ----- approval workflow: a finance/sales role requests, owner approves ----- */
async function requestCostChange({ user, productId, change, note }) {
  const doc = await ProductCost.findOneAndUpdate(
    { companyId: user.companyId, productId },
    { $set: { pendingChange: { ...change, requestedBy: user.id, requestedAt: new Date(), note } } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  await publish("COST_CHANGE_REQUESTED", user.companyId, { productId }, { notifyMsg: "A product cost change is awaiting owner approval" });
  return doc;
}

async function approveCostChange({ user, productId, approve }) {
  const doc = await ProductCost.findOne({ companyId: user.companyId, productId });
  if (!doc || !doc.pendingChange) throw err("No pending cost change", 404);
  if (String(doc.pendingChange.requestedBy) === String(user.id)) throw err("Approval matrix: requester cannot approve", 403);
  if (approve) {
    const { purchaseCost, productionCost, packagingCost, storageCost, transportCost, sellingPrice } = doc.pendingChange;
    Object.assign(doc, { purchaseCost, productionCost, packagingCost, storageCost, transportCost, sellingPrice });
    await publish("COST_CHANGE_APPROVED", user.companyId, { productId });
  }
  doc.pendingChange = null;
  await doc.save();
  return doc;
}

/* ----- profitability analytics ----- */
async function productProfitability({ companyId, from, to }) {
  const match = { companyId: oid(companyId), status: { $in: ["delivered", "shipped", "confirmed"] } };
  if (from || to) match.placedAt = { ...(from && { $gte: new Date(from) }), ...(to && { $lte: new Date(to) }) };

  const sales = await Order.aggregate([
    { $match: match }, { $unwind: "$items" },
    { $group: { _id: "$items.productId", revenue: { $sum: { $multiply: ["$items.qty", "$items.price"] } }, units: { $sum: "$items.qty" }, name: { $first: "$items.name" } } },
  ]);
  const costs = await ProductCost.find({ companyId });
  const costMap = new Map(costs.map((c) => [String(c.productId), c]));

  return sales.map((s) => {
    const c = costMap.get(String(s._id));
    const cost = (c ? c.totalCost : 0) * s.units;
    const profit = s.revenue - cost;
    return {
      productId: s._id, name: s.name, units: s.units,
      revenue: +s.revenue.toFixed(2), cost: +cost.toFixed(2), profit: +profit.toFixed(2),
      marginPct: s.revenue ? +((profit / s.revenue) * 100).toFixed(1) : 0,
      hasCostData: !!c,
    };
  }).sort((a, b) => b.profit - a.profit);
}

/** Inventory valuation = qty × owner-approved totalCost per product. */
async function inventoryValuation({ companyId, warehouseId }) {
  const match = { ownerType: "company", ownerId: oid(companyId) };
  if (warehouseId) match.warehouseId = oid(warehouseId);
  const rows = await Inventory.aggregate([
    { $match: match },
    { $group: { _id: "$productId", qty: { $sum: { $add: ["$onlineStock", "$offlineStock"] } } } },
  ]);
  const costs = await ProductCost.find({ companyId });
  const costMap = new Map(costs.map((c) => [String(c.productId), c.totalCost]));
  let total = 0;
  const detail = rows.map((r) => {
    const v = (costMap.get(String(r._id)) || 0) * r.qty;
    total += v;
    return { productId: r._id, qty: r.qty, value: +v.toFixed(2) };
  });
  return { totalValue: +total.toFixed(2), detail };
}

/** Transport cost analytics: monthly + per-warehouse + totals. */
async function transportAnalytics({ companyId, from, to }) {
  const match = { companyId: oid(companyId) };
  if (from || to) match.createdAt = { ...(from && { $gte: new Date(from) }), ...(to && { $lte: new Date(to) }) };
  const [monthly, byWarehouse, totals] = await Promise.all([
    ShipmentCost.aggregate([{ $match: match }, { $group: { _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } }, total: { $sum: "$totalCost" }, shipments: { $sum: 1 }, units: { $sum: "$unitsShipped" } } }, { $sort: { "_id.y": 1, "_id.m": 1 } }]),
    ShipmentCost.aggregate([{ $match: { ...match, warehouseId: { $ne: null } } }, { $group: { _id: "$warehouseId", total: { $sum: "$totalCost" }, shipments: { $sum: 1 } } }]),
    ShipmentCost.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: "$totalCost" }, units: { $sum: "$unitsShipped" }, shipments: { $sum: 1 } } }]),
  ]);
  const t = totals[0] || { total: 0, units: 0, shipments: 0 };
  return {
    totalCost: t.total, totalShipments: t.shipments,
    avgCostPerShipment: t.shipments ? +(t.total / t.shipments).toFixed(2) : 0,
    avgCostPerUnit: t.units ? +(t.total / t.units).toFixed(2) : 0,
    monthly, byWarehouse,
  };
}

module.exports = { requestCostChange, approveCostChange, productProfitability, inventoryValuation, transportAnalytics };
