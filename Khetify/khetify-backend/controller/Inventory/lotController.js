const lotService = require("../../services/lotService");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const Inventory = require("../../model/Inventory/Inventory");
const Warehouse = require("../../model/Warehouse/Warehouse");

/** GET /api/lots?productId=&warehouseId=&expiring=true&expired=true */
exports.getLots = async (req, res) => {
  try {
    // Warehouse-level access: scoped users only see lots in their assigned
    // warehouses; an explicit warehouseId outside the scope is rejected.
    const scope = await warehouseScope(req.user);
    if (scope && req.query.warehouseId && !inScope(scope, req.query.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    const rows = await lotService.getLots(req.user.companyId, { ...req.query, ...(scope && { warehouseIds: scope }) });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getLots error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** POST /api/lots/receive  { productId, warehouseId?, lotNumber, batchNumber, expiryDate?, qty, lowStockThreshold? } */
exports.receiveLot = async (req, res) => {
  try {
    // Warehouse-level access: a scoped user can only receive into their own warehouse.
    const scope = await warehouseScope(req.user);
    if (scope && req.body.warehouseId && !inScope(scope, req.body.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    const inv = await lotService.receiveLot({
      ownerId: req.user.companyId,
      performedBy: req.user.id,
      ...req.body,
      qty: Number(req.body.qty),
    });
    res.json({ success: true, message: "Lot received into stock", data: inv });
  } catch (err) {
    console.error("receiveLot error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** POST /api/lots/transfer  { inventoryId, toWarehouseId, qty } */
exports.transferLot = async (req, res) => {
  try {
    // Tenant + warehouse-level guards:
    //  - the source lot must belong to THIS company;
    //  - a scoped operations manager can only transfer OUT of their own warehouse;
    //  - the destination must be one of the company's warehouses (any of them —
    //    sending across warehouses is exactly what transfers are for).
    const srcRow = await Inventory.findOne({ _id: req.body.inventoryId, ownerId: req.user.companyId }).select("warehouseId");
    if (!srcRow) return res.status(404).json({ success: false, message: "Lot not found" });
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, srcRow.warehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — wrong warehouse" });
    }
    const destOk = await Warehouse.exists({ _id: req.body.toWarehouseId, companyId: req.user.companyId });
    if (!destOk) return res.status(400).json({ success: false, message: "Destination warehouse not found" });

    const out = await lotService.transferLot({ ...req.body, performedBy: req.user.id });
    res.json({ success: true, message: "Transfer complete", data: out });
  } catch (err) {
    console.error("transferLot error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** POST /api/lots/sell-fefo  { productId, qty, channel?, refId? } */
exports.sellFefo = async (req, res) => {
  try {
    const consumed = await lotService.sellFEFO({
      ownerId: req.user.companyId,
      performedBy: req.user.id,
      ...req.body,
    });
    res.json({ success: true, message: "Stock deducted (FEFO)", data: consumed });
  } catch (err) {
    console.error("sellFefo error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};
