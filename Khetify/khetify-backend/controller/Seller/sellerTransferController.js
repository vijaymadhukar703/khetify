const sellerTransferService = require("../../services/sellerTransferService");
const lotService = require("../../services/lotService");
const Warehouse = require("../../model/Warehouse/Warehouse");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const { notify } = require("../../services/notificationService");

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error", ...(err.data ? { data: err.data } : {}) });

/** GET /api/seller/transfers/warehouses — ALL warehouses owned by the seller
 * ACCOUNT (never manager-scoped), for the transfer DESTINATION picker + the
 * "need 2 warehouses" guard. A manager may send to any of the seller's
 * warehouses even if it isn't assigned to them. Strictly seller-scoped. */
exports.accountWarehouses = async (req, res) => {
  try {
    const rows = await Warehouse.find({ sellerId: req.user.sellerId }).select("name code isActive").sort({ name: 1 });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/transfers/stock?warehouseId= — the products the seller HOLDS
 * in a warehouse (in-stock lots, grouped by product), to populate the transfer
 * Product picker. Owner + warehouse scoped; NOT gated by the paid inventory
 * view (moving your own stock shouldn't need a plan). */
exports.warehouseStock = async (req, res) => {
  try {
    const warehouseId = req.query.warehouseId;
    if (!warehouseId) return res.status(400).json({ success: false, message: "warehouseId is required" });

    // The warehouse must be the seller's own (never another seller's).
    const owns = await Warehouse.exists({ _id: warehouseId, sellerId: req.user.sellerId });
    if (!owns) return res.status(404).json({ success: false, message: "Warehouse not found" });

    // For a PULL request you're asking ANOTHER of your warehouses to send stock,
    // so the holder needn't be one you're assigned to. For a PUSH (sending from
    // your own warehouse) keep the manager-scope check.
    if (!req.query.forRequest) {
      const scope = await warehouseScope(req.user);
      if (scope && !inScope(scope, warehouseId)) {
        return res.status(403).json({ success: false, message: "That warehouse isn't assigned to you" });
      }
    }

    const rows = await lotService.getLots(req.user.sellerId, { ownerType: "seller", warehouseId });
    const live = rows.filter((r) => (r.availableStock || 0) > 0);

    // Group the in-stock lots by product so the picker lists distinct products
    // (the accept step FEFO-picks across that product's lots).
    const byProduct = new Map();
    for (const r of live) {
      const p = r.productId || {};
      const id = String(p._id || r.productId);
      if (!byProduct.has(id)) byProduct.set(id, { productId: id, productName: p.productName || "—", skuNumber: p.skuNumber || "", availableQty: 0, lots: [] });
      const entry = byProduct.get(id);
      entry.availableQty += r.availableStock;
      entry.lots.push({ lotNumber: r.lotNumber || r.batchNumber, expiryDate: r.expiryDate || null, availableStock: r.availableStock });
    }
    const data = Array.from(byProduct.values()).sort((a, b) => a.productName.localeCompare(b.productName));
    res.json({ success: true, count: data.length, data });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/transfers — the seller's inter-warehouse transfer requests
 * (with their linked shipment). Owner + warehouse scoped. */
exports.listTransfers = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const rows = await sellerTransferService.listRequests(req.user.sellerId, scope, req.query.status);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/transfers — create a transfer request (no stock moves yet).
 * Body: { fromWarehouseId (holder/source), toWarehouseId (receiver), productId,
 * qty, note, mode? "push"|"pull" }. Stock always flows source → receiver; mode
 * only sets who initiates/accepts. */
exports.createTransfer = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const mode = req.body.mode === "pull" ? "pull" : "push";
    const { doc, fromName, toName } = await sellerTransferService.createRequest({
      sellerId: req.user.sellerId,
      fromWarehouseId: req.body.fromWarehouseId,
      toWarehouseId: req.body.toWarehouseId,
      productId: req.body.productId,
      qty: req.body.qty,
      note: req.body.note,
      requestedBy: req.user.id,
      scope,
      mode,
    });
    await notify({
      recipientType: "seller", recipientId: req.user.sellerId, type: "shipment",
      title: mode === "pull" ? "New stock request" : "New transfer request",
      body: mode === "pull"
        ? `${doc.qty} unit(s) requested from ${fromName} → ${toName}.`
        : `${doc.qty} unit(s) to transfer from ${fromName} → ${toName}.`,
      payload: { transferRequestId: doc._id, kind: "transfer_request" },
    }).catch(() => {});
    res.status(201).json({
      success: true,
      message: mode === "pull" ? "Request sent — the holding warehouse can accept it" : "Transfer requested — accept it to create the shipment",
      data: doc,
    });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/transfers/:id/accept — FEFO-pick + create a planned Shipment. */
exports.acceptTransfer = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const { doc, lineCount } = await sellerTransferService.acceptRequest({
      sellerId: req.user.sellerId, id: req.params.id, performedBy: req.user.id, note: req.body?.note, scope,
    });
    res.json({ success: true, message: `Accepted — shipment created with ${lineCount} lot(s). Dispatch it from Shipments.`, data: doc });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/transfers/:id/reject */
exports.rejectTransfer = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const doc = await sellerTransferService.rejectRequest({ sellerId: req.user.sellerId, id: req.params.id, note: req.body?.note, performedBy: req.user.id, scope });
    res.json({ success: true, message: "Request rejected", data: doc });
  } catch (err) { fail(res, err); }
};
