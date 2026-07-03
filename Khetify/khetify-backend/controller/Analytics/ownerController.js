const mongoose = require("mongoose");
const Warehouse = require("../../model/Warehouse/Warehouse");
const Inventory = require("../../model/Inventory/Inventory");
const { productProfitability, inventoryValuation, transportAnalytics } = require("../../services/costingService");

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** GET /api/owner/dashboard?from=&to= — executive KPIs. */
exports.dashboard = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { from, to } = req.query;

    const [profitRows, valuation, transport, warehouses, stockByWh] = await Promise.all([
      productProfitability({ companyId, from, to }),
      inventoryValuation({ companyId }),
      transportAnalytics({ companyId, from, to }),
      Warehouse.find({ companyId, isActive: true }).select("name capacityUnits"),
      Inventory.aggregate([
        { $match: { ownerType: "company", ownerId: oid(companyId) } },
        { $group: { _id: "$warehouseId", units: { $sum: { $add: ["$onlineStock", "$offlineStock"] } } } },
      ]),
    ]);

    const revenue = profitRows.reduce((s, r) => s + r.revenue, 0);
    const cost = profitRows.reduce((s, r) => s + r.cost, 0);
    const profit = revenue - cost - transport.totalCost;
    const losses = profitRows.filter((r) => r.profit < 0).reduce((s, r) => s + Math.abs(r.profit), 0);

    const unitsMap = new Map(stockByWh.map((r) => [String(r._id), r.units]));
    const utilization = warehouses.map((w) => ({
      warehouseId: w._id, name: w.name, capacityUnits: w.capacityUnits || null,
      units: unitsMap.get(String(w._id)) || 0,
      utilizationPct: w.capacityUnits ? +(((unitsMap.get(String(w._id)) || 0) / w.capacityUnits) * 100).toFixed(1) : null,
    }));

    res.json({
      success: true,
      data: {
        kpis: {
          totalRevenue: +revenue.toFixed(2),
          totalCost: +cost.toFixed(2),
          transportCost: transport.totalCost,
          totalProfit: +profit.toFixed(2),
          totalLoss: +losses.toFixed(2),
          profitMarginPct: revenue ? +((profit / revenue) * 100).toFixed(1) : 0,
          inventoryValue: valuation.totalValue,
        },
        topSelling: [...profitRows].sort((a, b) => b.units - a.units).slice(0, 5),
        topProfitable: profitRows.slice(0, 5),
        lowMargin: profitRows.filter((r) => r.hasCostData).sort((a, b) => a.marginPct - b.marginPct).slice(0, 5),
        warehouseUtilization: utilization,
        transport: { monthly: transport.monthly, avgCostPerUnit: transport.avgCostPerUnit, avgCostPerShipment: transport.avgCostPerShipment },
      },
    });
  } catch (err) {
    console.error("ownerDashboard:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
