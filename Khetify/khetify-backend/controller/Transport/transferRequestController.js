const TransferRequest = require("../../model/Transport/TransferRequest");
const Warehouse = require("../../model/Warehouse/Warehouse");
const Product = require("../../model/Company/productModel");
const { warehouseScope, inScope } = require("../../services/warehouseScope");
const { notifyWarehouseTeam, notifyAdmin } = require("../../services/notificationService");
const audit = require("../../services/auditService");
const Inventory = require("../../model/Inventory/Inventory");
const shipmentService = require("../../services/shipmentService");
const { hasCapability } = require("../../config/permissions");

const fail = (res, e) => res.status(e.status || 500).json({ success: false, message: e.message || "Server error" });

const POPULATE = [
  { path: "productId", select: "productName skuNumber" },
  { path: "fromWarehouseId", select: "name code" },
  { path: "toWarehouseId", select: "name code" },
  { path: "requestedBy", select: "name" },
  { path: "decidedBy", select: "name" },
];

/**
 * POST /api/transfer-requests
 * Warehouse B (the requester) asks warehouse A for qty of a product.
 * Scoped users request FOR their own warehouse; the source team and the
 * company admin are notified immediately.
 */
exports.create = async (req, res) => {
  try {
    const { fromWarehouseId, toWarehouseId: bodyTo, productId, qty, note } = req.body;
    if (!fromWarehouseId || !productId || !qty || qty <= 0) {
      return res.status(400).json({ success: false, message: "fromWarehouseId, productId and positive qty are required" });
    }

    const scope = await warehouseScope(req.user);
    // The requesting warehouse: a scoped manager requests for THEIR warehouse;
    // the admin may specify any.
    const toWarehouseId = scope ? (bodyTo && inScope(scope, bodyTo) ? bodyTo : scope[0]) : bodyTo;
    if (!toWarehouseId) return res.status(400).json({ success: false, message: "toWarehouseId is required" });
    if (String(fromWarehouseId) === String(toWarehouseId)) {
      return res.status(400).json({ success: false, message: "Source and destination must differ" });
    }

    const [fromOk, toOk, product] = await Promise.all([
      Warehouse.findOne({ _id: fromWarehouseId, companyId: req.user.companyId }).select("name"),
      Warehouse.findOne({ _id: toWarehouseId, companyId: req.user.companyId }).select("name"),
      Product.findOne({ _id: productId, companyId: req.user.companyId }).select("productName"),
    ]);
    if (!fromOk || !toOk) return res.status(400).json({ success: false, message: "Warehouse not found" });
    if (!product) return res.status(400).json({ success: false, message: "Product not found" });

    const doc = await TransferRequest.create({
      companyId: req.user.companyId,
      productId, fromWarehouseId, toWarehouseId,
      qty, note, requestedBy: req.user.id,
    });

    const msg = `${toOk.name} requests ${qty} × ${product.productName} from ${fromOk.name}`;
    // A's team receives the request message; the admin is in the loop.
    await notifyWarehouseTeam(req.user.companyId, fromWarehouseId, {
      title: "Stock request received", body: msg, payload: { transferRequestId: doc._id, kind: "transfer_request" },
    });
    await notifyAdmin(req.user.companyId, {
      title: "New inter-warehouse stock request", body: msg, payload: { transferRequestId: doc._id, kind: "transfer_request" },
    });
    await audit.log({ req, action: "transfer_request.created", entityType: "TransferRequest", entityId: doc._id, after: { fromWarehouseId, toWarehouseId, productId, qty } });

    const out = await TransferRequest.findById(doc._id).populate(POPULATE);
    res.status(201).json({ success: true, message: "Request sent to the source warehouse", data: out });
  } catch (e) { fail(res, e); }
};

/**
 * GET /api/transfer-requests — scoped users see requests touching their
 * warehouses (incoming to fulfil OR their own outgoing asks); admin sees all.
 */
exports.list = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const filter = { companyId: req.user.companyId };
    if (req.query.status) filter.status = req.query.status;
    if (scope) filter.$or = [{ fromWarehouseId: { $in: scope } }, { toWarehouseId: { $in: scope } }];
    const rows = await TransferRequest.find(filter)
      .populate(POPULATE)
      // The shipment this request was fulfilled by — a one-to-one link
      // (TransferRequest.shipmentId, set by accept()). Needed only for its
      // reference; lrNumber is what shipmentRef() falls back from.
      .populate("shipmentId", "lrNumber")
      .sort({ createdAt: -1 }).limit(300).lean();
    // ADDITIVE: `transferRef` — the SH-… of the linked shipment, the SAME value
    // Transfer History shows (shipmentService.shipmentRef is the one definition,
    // so the two can never drift). null until a shipment exists → the UI reads
    // "Not created". Every existing field, including the populated shipmentId the
    // UI already uses as a truthy "shipment created" flag, is passed through.
    const data = rows.map((r) => ({ ...r, transferRef: shipmentService.shipmentRef(r.shipmentId) }));
    res.json({ success: true, count: data.length, data });
  } catch (e) { fail(res, e); }
};

/** Load + guard a pending request: only the SOURCE warehouse's team (or admin) decides. */
async function loadPending(req, res) {
  const doc = await TransferRequest.findOne({ _id: req.params.id, companyId: req.user.companyId });
  if (!doc) { res.status(404).json({ success: false, message: "Request not found" }); return null; }
  if (doc.status !== "requested") { res.status(409).json({ success: false, message: `Request already ${doc.status}` }); return null; }
  const scope = await warehouseScope(req.user);
  if (scope && !inScope(scope, doc.fromWarehouseId)) {
    res.status(403).json({ success: false, message: "Access denied — only the source warehouse can decide this request" });
    return null;
  }
  return doc;
}

async function ack(req, doc, status, extraBody = "") {
  const out = await TransferRequest.findById(doc._id).populate(POPULATE);
  const msg = `${out.fromWarehouseId?.name} ${status} the request for ${out.qty} × ${out.productId?.productName}${extraBody}`;
  // Acknowledgment to the requesting warehouse (B) + admin in the loop.
  await notifyWarehouseTeam(req.user.companyId, doc.toWarehouseId, {
    title: status === "accepted" ? "Request accepted" : "Request rejected",
    body: msg, payload: { transferRequestId: doc._id, shipmentId: doc.shipmentId, kind: "transfer_request" },
  });
  await notifyAdmin(req.user.companyId, {
    title: `Stock request ${status}`, body: msg, payload: { transferRequestId: doc._id, shipmentId: doc.shipmentId, kind: "transfer_request" },
  });
  await audit.log({ req, action: `transfer_request.${status}`, entityType: "TransferRequest", entityId: doc._id, after: { status, decidedBy: req.user.id, shipmentId: doc.shipmentId } });
  return out;
}

/**
 * POST /api/transfer-requests/:id/accept
 * ACCEPT WITH STOCK VERIFICATION: before accepting, the system checks the
 * source warehouse actually holds the requested quantity of the product.
 *  - Insufficient → 409 alert with exactly how much is available; the request
 *    stays pending so the manager can restock and accept later, or reject
 *    with a note. Nothing is created.
 *  - Sufficient → the transfer is performed automatically: lots are picked
 *    FEFO (earliest expiry first) and a planned shipment from source →
 *    requester is created and linked. It then flows through the normal
 *    approve/dispatch → in-transit → camera-scan receive lifecycle, and the
 *    request is marked "fulfilled" when the destination verifies receipt.
 */
exports.accept = async (req, res) => {
  try {
    // Accepting a stock request CREATES a warehouse-to-warehouse transfer
    // shipment, so it requires inventory:transfer. company_admin is denied this
    // (ROLE_DENIED) — admins see and oversee requests but cannot move stock
    // between warehouses; the source warehouse's operations manager accepts.
    if (!hasCapability(req.user.role, "inventory:transfer")) {
      return res.status(403).json({ success: false, message: "Not allowed to transfer between warehouses" });
    }
    const doc = await loadPending(req, res);
    if (!doc) return;

    // 1) verify the source warehouse holds enough of the product (FEFO order)
    const lots = await Inventory.find({
      ownerId: req.user.companyId, ownerType: "company",
      warehouseId: doc.fromWarehouseId, productId: doc.productId,
      batchNumber: { $ne: null }, availableStock: { $gt: 0 },
    }).select("availableStock expiryDate lotNumber");
    lots.sort((a, b) => {
      if (!a.expiryDate && !b.expiryDate) return 0;
      if (!a.expiryDate) return 1; // no-expiry lots go last (FEFO)
      if (!b.expiryDate) return -1;
      return a.expiryDate - b.expiryDate;
    });
    const available = lots.reduce((s_, l) => s_ + l.availableStock, 0);

    if (available < doc.qty) {
      // Alert: stock not available — guide the manager on what to do next.
      return res.status(409).json({
        success: false,
        message: `Stock not available — only ${available} of ${doc.qty} requested unit(s) in the source warehouse. Restock (receive a lot or request from another warehouse) and accept later, or reject this request with a note.`,
        data: { available, requested: doc.qty },
      });
    }

    // 2) FEFO-pick lots to cover the quantity
    const lines = [];
    let remaining = doc.qty;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.availableStock, remaining);
      lines.push({ inventoryId: lot._id, qty: take });
      remaining -= take;
    }

    // 3) perform the sending: create the linked transfer shipment (planned)
    const toWh = await Warehouse.findOne({ _id: doc.toWarehouseId, companyId: req.user.companyId }).select("name");
    const shipment = await shipmentService.createShipment(req.user.companyId, {
      refType: "TransferRequest", refId: doc._id,
      fromWarehouseId: doc.fromWarehouseId, toType: "warehouse", toWarehouseId: doc.toWarehouseId,
      toLabel: `${toWh?.name || "Warehouse"} (stock request)`, lines, performedBy: req.user.id,
    });

    doc.status = "accepted";
    doc.decidedBy = req.user.id;
    doc.decidedAt = new Date();
    doc.shipmentId = shipment._id;
    if (req.body?.note) doc.decisionNote = req.body.note;
    await doc.save();

    const out = await ack(req, doc, "accepted", ` — shipment created with ${lines.length} lot(s), ready to dispatch`);
    res.json({
      success: true,
      message: `Request accepted — transfer shipment created with ${lines.length} lot(s). Dispatch it from the Shipments tab.`,
      data: out,
    });
  } catch (e) { fail(res, e); }
};

/** POST /api/transfer-requests/:id/reject */
exports.reject = async (req, res) => {
  try {
    const doc = await loadPending(req, res);
    if (!doc) return;
    doc.status = "rejected";
    doc.decidedBy = req.user.id;
    doc.decidedAt = new Date();
    if (req.body?.note) doc.decisionNote = req.body.note;
    await doc.save();
    const out = await ack(req, doc, "rejected");
    res.json({ success: true, message: "Request rejected", data: out });
  } catch (e) { fail(res, e); }
};
