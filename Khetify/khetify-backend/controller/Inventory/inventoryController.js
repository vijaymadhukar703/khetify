const Inventory = require("../../model/Inventory/Inventory");
const { warehouseScope } = require("../../services/warehouseScope");
const StockMovement = require("../../model/Inventory/StockMovement");
const inventoryService = require("../../services/inventoryService");

/** GET /api/inventory  — list this company's inventory (filterable). */
exports.getInventory = async (req, res) => {
  try {
    const { productId, channel, lowStock } = req.query;
    const filter = { ownerType: "company", ownerId: req.user.companyId };
    if (productId) filter.productId = productId;

    // Warehouse-level access: a scoped operations manager sees the SAME
    // inventory rows the company admin sees for their warehouse — one source
    // of truth, filtered to the assignment.
    const scope = await warehouseScope(req.user);
    if (scope) filter.warehouseId = { $in: scope };

    let rows = await Inventory.find(filter)
      .populate("productId", "productName category productImages")
      .sort({ updatedAt: -1 });

    if (lowStock === "true") {
      rows = rows.filter(
        (r) => r.lowStockThreshold > 0 && r.availableStock <= r.lowStockThreshold
      );
    }
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getInventory error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST /api/inventory/adjust  { productId, delta, channel?, note? } */
exports.adjustInventory = async (req, res) => {
  try {
    const { productId, delta, channel, note } = req.body;
    if (!productId || typeof delta !== "number") {
      return res
        .status(400)
        .json({ success: false, message: "productId and numeric delta are required" });
    }
    const inv = await inventoryService.adjust({
      productId,
      ownerType: "company",
      ownerId: req.user.companyId,
      delta,
      channel,
      note,
      performedBy: req.user.id,
    });
    res.json({ success: true, message: "Inventory adjusted", data: inv });
  } catch (err) {
    console.error("adjustInventory error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** POST /api/inventory/reserve  { productId, qty, refId? }  (premium: reserved_stock) */
exports.reserveInventory = async (req, res) => {
  try {
    const { productId, qty, refId } = req.body;
    const inv = await inventoryService.reserve({
      productId,
      ownerType: "company",
      ownerId: req.user.companyId,
      qty,
      refId,
      performedBy: req.user.id,
    });
    res.json({ success: true, message: "Reserved", data: inv });
  } catch (err) {
    res
      .status(err.status || 500)
      .json({ success: false, message: err.message || "Server error" });
  }
};

/** GET /api/inventory/:productId/movements — ledger history for a product. */
exports.getMovements = async (req, res) => {
  try {
    const rows = await StockMovement.find({
      productId: req.params.productId,
      ownerId: req.user.companyId,
    })
      .sort({ createdAt: -1 })
      .limit(200);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
