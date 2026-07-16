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
    // Warehouse-scoped users must not see (or count) lots they haven't received
    // yet — those sit in inTransitStock until Confirm Receive.
    const rows = await lotService.getLots(req.user.companyId, {
      ...req.query,
      ...(scope && { warehouseIds: scope, excludePending: true }),
    });
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
    // COMPANY → COMPANY WAREHOUSE: the main Company assigning a new lot to a
    // warehouse books it as IN TRANSIT; that warehouse must scan the parent lot
    // and Confirm Receive before it becomes stock. Any other creator (and every
    // GRN posting, which IS a receipt) stocks it immediately, as before.
    const pendingReceipt = req.user.role === "company_admin" && !!req.body.warehouseId;
    const inv = await lotService.receiveLot({
      ownerId: req.user.companyId,
      performedBy: req.user.id,
      ...req.body,
      qty: Number(req.body.qty),
      pendingReceipt,
    });
    res.json({
      success: true,
      message: pendingReceipt
        ? "Lot created — sent to the warehouse, awaiting its Receive confirmation"
        : "Lot received into stock",
      data: inv,
    });
  } catch (err) {
    console.error("receiveLot error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * GET /api/lots/incoming?lot=<PARENT LOT NO>
 * Company Warehouse "Receive Lot" scan: resolve an EXACT parent lot to the lot
 * awaiting receipt at THIS warehouse. Read-only — moves no stock.
 */
exports.incomingLot = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const r = await lotService.findPendingLot(req.user.companyId, {
      lotNumber: req.query.lot,
      allowedWarehouseIds: scope,
    });
    res.json({ success: true, data: r });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/**
 * POST /api/lots/:id/confirm-receipt
 * Company Warehouse Confirm Receive: the ONLY place a pending lot's quantity
 * lands on this warehouse's books. Atomic; a repeat confirm is rejected.
 */
exports.confirmLotReceipt = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const inv = await lotService.confirmLotReceipt(req.user.companyId, req.params.id, {
      performedBy: req.user.id,
      allowedWarehouseIds: scope,
    });
    res.json({ success: true, message: "Received into your warehouse", data: inv });
  } catch (err) {
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
