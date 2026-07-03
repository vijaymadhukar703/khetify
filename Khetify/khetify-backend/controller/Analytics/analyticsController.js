const Inventory = require("../../model/Inventory/Inventory");
const Warehouse = require("../../model/Warehouse/Warehouse");
const Order = require("../../model/Order/Order");

const DAY = 86400000;
const SOLD = ["confirmed", "shipped", "delivered"];

/**
 * GET /api/analytics/overview — the numbers behind the Analytics & Reports page.
 * Aggregates the company's lots, warehouses and orders into inventory valuation,
 * stock-health buckets, warehouse utilisation, category mix, top products /
 * customers and order-fulfilment metrics.  Premium (advanced_analytics).
 */
exports.getOverview = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const now = new Date();

    const [lots, warehouses, orders] = await Promise.all([
      Inventory.find({ ownerType: "company", ownerId: companyId, batchNumber: { $ne: null } })
        .populate("productId", "productName category mrp")
        .populate("warehouseId", "name capacityUnits"),
      Warehouse.find({ companyId }).select("name capacityUnits"),
      Order.find({ companyId }).select("items totalUnits totalAmount status customerName channel placedAt"),
    ]);

    /* ---------- inventory health + valuation ---------- */
    let stockValue = 0;
    let totalUnits = 0;
    let lowStock = 0;
    let outOfStock = 0;
    let expiring = 0;
    let expired = 0;
    let deadStockValue = 0;
    const byCategory = {};

    for (const l of lots) {
      const price = l.productId?.mrp || 0;
      const units = l.availableStock || 0;
      const value = units * price;
      totalUnits += units;
      stockValue += value;

      if (units <= 0) outOfStock += 1;
      else if (l.lowStockThreshold > 0 && units <= l.lowStockThreshold) lowStock += 1;

      if (l.expiryDate) {
        const days = Math.ceil((new Date(l.expiryDate) - now) / DAY);
        if (days < 0 && units > 0) {
          expired += 1;
          deadStockValue += value;
        } else if (days >= 0 && days <= 90 && units > 0) {
          expiring += 1;
        }
      }

      const cat = l.productId?.category || "Uncategorised";
      if (!byCategory[cat]) byCategory[cat] = { category: cat, units: 0, value: 0 };
      byCategory[cat].units += units;
      byCategory[cat].value += value;
    }

    /* ---------- warehouse utilisation ---------- */
    const whUnits = {};
    for (const l of lots) {
      const id = String(l.warehouseId?._id || "unassigned");
      whUnits[id] = (whUnits[id] || 0) + (l.availableStock || 0);
    }
    const byWarehouse = warehouses.map((w) => {
      const units = whUnits[String(w._id)] || 0;
      const utilizationPct = w.capacityUnits ? Math.min(100, Math.round((units / w.capacityUnits) * 100)) : null;
      return { id: w._id, name: w.name, units, capacity: w.capacityUnits || null, utilizationPct };
    });

    /* ---------- orders: fulfilment + top products / customers ---------- */
    const totalOrders = orders.length;
    let delivered = 0;
    let revenue = 0;
    let unitsSold = 0;
    let returns = 0;
    const productAgg = {};
    const customerAgg = {};

    for (const o of orders) {
      if (o.status === "delivered") delivered += 1;
      if (o.status === "returned") {
        returns += o.totalUnits || 0;
        continue;
      }
      if (!SOLD.includes(o.status)) continue;
      revenue += o.totalAmount || 0;
      unitsSold += o.totalUnits || 0;

      for (const it of o.items || []) {
        const key = it.name || String(it.productId);
        if (!productAgg[key]) productAgg[key] = { name: key, units: 0, revenue: 0 };
        productAgg[key].units += it.qty || 0;
        productAgg[key].revenue += (it.qty || 0) * (it.price || 0);
      }
      const cust = o.customerName || "Unknown";
      if (!customerAgg[cust]) customerAgg[cust] = { name: cust, orders: 0, revenue: 0 };
      customerAgg[cust].orders += 1;
      customerAgg[cust].revenue += o.totalAmount || 0;
    }

    const topProducts = Object.values(productAgg).sort((a, b) => b.units - a.units).slice(0, 5);
    const topCustomers = Object.values(customerAgg).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    const fulfillmentRate = totalOrders ? Math.round((delivered / totalOrders) * 100) : 0;

    res.json({
      success: true,
      data: {
        inventory: {
          totalLots: lots.length,
          totalUnits,
          stockValue,
          lowStock,
          outOfStock,
          expiring,
          expired,
          deadStockValue,
        },
        byCategory: Object.values(byCategory).sort((a, b) => b.value - a.value),
        byWarehouse,
        sales: { totalOrders, delivered, fulfillmentRate, revenue, unitsSold, returns },
        topProducts,
        topCustomers,
      },
    });
  } catch (err) {
    console.error("analytics getOverview error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
