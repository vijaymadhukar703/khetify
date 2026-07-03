const lotService = require("../../services/lotService");
const { warehouseScope } = require("../../services/warehouseScope");

/**
 * GET /api/seller/lots — the authenticated seller's OWN lot rows
 * (ownerType "seller", ownerId = sellerId), product + warehouse populated, in
 * the SAME shape as the company lots endpoint so the seller UI can reuse the
 * company list/dashboard logic. Read-only: sellers receive lots via supply
 * (Phase 3), they never create them. Scope is implicitly the seller's own
 * warehouses (their inventory rows only).
 */
exports.getSellerLots = async (req, res) => {
  try {
    // Warehouse-level scoping: a seller_manager sees ONLY their assigned
    // warehouse(s)' lots — the SAME owner-scoped rows the seller_admin sees, just
    // a filtered slice (one source of truth, stays in sync). seller_admin: null
    // scope → all.
    const scope = await warehouseScope(req.user);
    const warehouseId = req.query.warehouseId;
    // A scoped manager can't widen past their warehouses by passing a foreign id.
    if (scope && warehouseId && !scope.includes(String(warehouseId))) {
      return res.json({ success: true, count: 0, data: [] });
    }
    const rows = await lotService.getLots(req.user.sellerId, {
      ownerType: "seller",
      productId: req.query.productId,
      warehouseId,
      warehouseIds: warehouseId ? undefined : scope || undefined,
      expiring: req.query.expiring,
      expired: req.query.expired,
    });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};
