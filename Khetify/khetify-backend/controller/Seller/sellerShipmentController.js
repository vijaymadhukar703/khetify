const shipmentService = require("../../services/shipmentService");
const Warehouse = require("../../model/Warehouse/Warehouse");
const TransferRequest = require("../../model/Transport/TransferRequest");
const orderCtrl = require("./sellerOrderController");
const { warehouseScope, inScope } = require("../../services/warehouseScope");

const sellerOwner = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });
const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/** GET /api/seller/shipments — the seller's shipments (supply + transfers),
 * owner + warehouse scoped. */
exports.list = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const rows = await shipmentService.listShipments(sellerOwner(req), { status: req.query.status, warehouseIds: scope || undefined });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/shipments/:id */
exports.get = async (req, res) => {
  try {
    const s = await shipmentService.getShipment(sellerOwner(req), req.params.id);
    res.json({ success: true, data: s });
  } catch (err) { fail(res, err); }
};

/** GET /api/seller/shipments/:id/manifest — build/return the scannable shipping
 * label (QR) so it can be PRINTED before dispatch. Only the source warehouse's
 * manager (or seller_admin) can print it. */
exports.manifest = async (req, res) => {
  try {
    const s = await shipmentService.getShipment(sellerOwner(req), req.params.id);
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, s.fromWarehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — not your source warehouse" });
    }
    const { qrPayload } = await shipmentService.ensureManifest(sellerOwner(req), req.params.id);
    res.json({ success: true, data: { qrPayload } });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/shipments/:id/pick { picks:[{ lineIndex, qty?, serials? }] }
 * — scan units/lots until each line's requested qty is met. Only the source
 * warehouse's manager (or seller_admin) may pick. */
exports.pick = async (req, res) => {
  try {
    const s = await shipmentService.getShipment(sellerOwner(req), req.params.id);
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, s.fromWarehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — not your source warehouse" });
    }
    const shipment = await shipmentService.pickShipment(sellerOwner(req), req.params.id, { picks: req.body.picks || [], performedBy: req.user.id });
    res.json({ success: true, message: shipment.status === "picked" ? "Fully picked — ready to pack" : "Pick updated", data: shipment });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/shipments/:id/pack — pack a fully-picked shipment (then it
 * moves to Dispatch). Only the source warehouse's manager (or seller_admin). */
exports.pack = async (req, res) => {
  try {
    const s = await shipmentService.getShipment(sellerOwner(req), req.params.id);
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, s.fromWarehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — not your source warehouse" });
    }
    const shipment = await shipmentService.packShipment(sellerOwner(req), req.params.id, { performedBy: req.user.id });
    // Customer-order shipment: keep the order tracker in step (→ packed).
    if (shipment.refType === "Order" && shipment.refId) {
      try { await orderCtrl.markOrderPacked(shipment.refId, req.user.sellerId); } catch (e) { console.error("order pack sync:", e.message); }
    }
    res.json({ success: true, message: "Packed — print the label to dispatch", data: shipment });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/shipments/:id/dispatch { labelPrinted, ...transport } —
 * stock leaves the source (in_transit). Dispatch is BLOCKED until the shipping
 * label has been printed (labelPrinted:true), mirroring the company. Only the
 * source warehouse's manager (or seller_admin) may dispatch. */
exports.dispatch = async (req, res) => {
  try {
    const s = await shipmentService.getShipment(sellerOwner(req), req.params.id);
    const scope = await warehouseScope(req.user);
    if (scope && !inScope(scope, s.fromWarehouseId)) {
      return res.status(403).json({ success: false, message: "Access denied — not your source warehouse" });
    }
    if (req.body.labelPrinted !== true) {
      return res.status(409).json({ success: false, message: "Print the shipping label before dispatch" });
    }
    const { shipment, qrPayload } = await shipmentService.dispatchShipment(sellerOwner(req), req.params.id, { performedBy: req.user.id });
    // Customer-order shipment moved NO stock (toType "customer"); ship the order
    // now — the single sale-deduction (commit reservation or FEFO) + mark shipped.
    if (shipment.refType === "Order" && shipment.refId) {
      try { await orderCtrl.shipOrder(shipment.refId, req.user.sellerId); } catch (e) { console.error("order ship sync:", e.message); }
    }
    res.json({ success: true, message: "Dispatched — stock is in transit", data: { _id: shipment._id, status: shipment.status, qrPayload } });
  } catch (err) { fail(res, err); }
};

/** POST /api/seller/shipments/:id/receive { qr, warehouseId?, lines? } —
 * scan-to-receive at the destination warehouse. Lands stock into B, marks the
 * linked transfer request fulfilled. */
exports.receive = async (req, res) => {
  try {
    if (!req.body.qr) return res.status(400).json({ success: false, message: "Scan the manifest QR to receive this shipment" });
    const sellerWarehouseIds = (await Warehouse.find({ sellerId: req.user.sellerId }).select("_id")).map((w) => String(w._id));
    const scope = await warehouseScope(req.user); // a manager can only receive into their own warehouse(s)
    const allowed = scope ? sellerWarehouseIds.filter((id) => scope.map(String).includes(id)) : sellerWarehouseIds;

    const { shipment, shortages } = await shipmentService.verifyReceipt(sellerOwner(req), req.params.id, {
      verifierId: req.user.id,
      qr: req.body.qr,
      warehouseId: req.body.warehouseId,
      allowedWarehouseIds: allowed,
      lines: req.body.lines || [],
      performedBy: req.user.id,
    });

    // Mark the linked transfer request fulfilled on a full receipt.
    if (shipment.refType === "TransferRequest" && shipment.refId && !shortages) {
      await TransferRequest.updateOne(
        { _id: shipment.refId, ownerType: "seller", ownerId: req.user.sellerId },
        { $set: { status: "fulfilled" } }
      );
    }
    res.json({ success: true, message: shortages ? `Received with ${shortages} discrepancy(ies)` : "Received in full — stock updated", data: { status: shipment.status, shortages } });
  } catch (err) { fail(res, err); }
};
