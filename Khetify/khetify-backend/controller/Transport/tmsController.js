const vehicleService = require("../../services/vehicleService");
const shipmentService = require("../../services/shipmentService");
const audit = require("../../services/auditService");
const { warehouseScope } = require("../../services/warehouseScope");
const { hasCapability } = require("../../config/permissions");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("TMS error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/* vehicles */
exports.listVehicles = async (req, res) => { try { const r = await vehicleService.listVehicles(req.user.companyId); res.json({ success: true, count: r.length, data: r }); } catch (e) { fail(res, e); } };
exports.createVehicle = async (req, res) => { try { res.status(201).json({ success: true, data: await vehicleService.createVehicle(req.user.companyId, req.body) }); } catch (e) { fail(res, e); } };
exports.updateVehicle = async (req, res) => { try { res.json({ success: true, data: await vehicleService.updateVehicle(req.user.companyId, req.params.id, req.body) }); } catch (e) { fail(res, e); } };

/* drivers */
exports.listDrivers = async (req, res) => { try { const r = await vehicleService.listDrivers(req.user.companyId); res.json({ success: true, count: r.length, data: r }); } catch (e) { fail(res, e); } };
exports.createDriver = async (req, res) => { try { res.status(201).json({ success: true, data: await vehicleService.createDriver(req.user.companyId, req.body) }); } catch (e) { fail(res, e); } };
exports.updateDriver = async (req, res) => { try { res.json({ success: true, data: await vehicleService.updateDriver(req.user.companyId, req.params.id, req.body) }); } catch (e) { fail(res, e); } };

/* shipments */
exports.listShipments = async (req, res) => {
  try {
    // Warehouse-level access: scoped users (assigned operations managers)
    // only see transfers touching their warehouses — e.g. Katni's manager
    // sees the incoming LOT-001 transfer; Indore's manager does not.
    const scope = await warehouseScope(req.user);
    const r = await shipmentService.listShipments(req.user.companyId, { ...req.query, ...(scope && { warehouseIds: scope }) });
    res.json({ success: true, count: r.length, data: r });
  } catch (e) { fail(res, e); }
};
exports.getShipment = async (req, res) => { try { res.json({ success: true, data: await shipmentService.getShipment(req.user.companyId, req.params.id) }); } catch (e) { fail(res, e); } };
exports.createShipment = async (req, res) => {
  try {
    // Warehouse-to-warehouse transfers require inventory:transfer. company_admin
    // is denied this capability (see config/permissions ROLE_DENIED), so admins
    // can still create customer/manual shipments but never initiate transfers.
    const isWarehouseTransfer = req.body.refType === "Transfer" || req.body.toType === "warehouse";
    if (isWarehouseTransfer && !hasCapability(req.user.role, "inventory:transfer")) {
      return res.status(403).json({ success: false, message: "Not allowed to transfer between warehouses" });
    }
    const s = await shipmentService.createShipment(req.user.companyId, { ...req.body, performedBy: req.user.id });
    res.status(201).json({ success: true, message: "Shipment planned", data: s });
  } catch (e) { fail(res, e); }
};
/** Scoped users may only act on shipments leaving THEIR warehouse. */
async function assertOutgoingScope(req, res) {
  const scope = await warehouseScope(req.user);
  if (!scope) return true;
  const Shipment = require("../../model/Transport/Shipment");
  const sh = await Shipment.findOne({ _id: req.params.id, companyId: req.user.companyId }).select("fromWarehouseId");
  if (!sh) { res.status(404).json({ success: false, message: "Shipment not found" }); return false; }
  if (sh.fromWarehouseId && !scope.includes(String(sh.fromWarehouseId))) {
    res.status(403).json({ success: false, message: "Access denied — only the source warehouse can dispatch this shipment" });
    return false;
  }
  return true;
}

exports.approve = async (req, res) => {
  try {
    if (!(await assertOutgoingScope(req, res))) return;
    const s_ = await shipmentService.approveShipment(req.user.companyId, req.params.id, { performedBy: req.user.id });
    await audit.log({ req, action: "shipment.approved", entityType: "Shipment", entityId: req.params.id, after: { status: s_.status } });
    res.json({ success: true, message: "Approved", data: { status: s_.status } });
  } catch (e) { fail(res, e); }
};
exports.dispatch = async (req, res) => {
  try {
    if (!(await assertOutgoingScope(req, res))) return;
    const r = await shipmentService.dispatchShipment(req.user.companyId, req.params.id, { ...req.body, performedBy: req.user.id });
    await audit.log({ req, action: "shipment.dispatched", entityType: "Shipment", entityId: req.params.id });
    res.json({ success: true, message: "Dispatched", data: { shipment: { _id: r.shipment._id, status: r.shipment.status }, qrPayload: r.qrPayload } });
  } catch (e) { fail(res, e); }
};
exports.verifyReceipt = async (req, res) => {
  try {
    const scope = await warehouseScope(req.user);
    const r = await shipmentService.verifyReceipt(req.user.companyId, req.params.id, { ...req.body, allowedWarehouseIds: scope, verifierId: req.user.id, performedBy: req.user.id });
    // Proof-of-delivery audit trail: who verified, when, at which warehouse,
    // which shipment and which lots — every verification leaves a row.
    await audit.log({
      req,
      action: "shipment.verified",
      entityType: "Shipment",
      entityId: req.params.id,
      after: {
        status: r.shipment.status,
        shortages: r.shortages,
        method: r.shipment.pod?.method,
        verifiedBy: r.shipment.pod?.verifiedBy,
        verifiedAt: r.shipment.pod?.verifiedAt,
        warehouseId: r.shipment.toWarehouseId,
        lots: (r.shipment.lines || []).map((l) => ({ lotNumber: l.lotNumber, qty: l.qty, receivedQty: l.receivedQty })),
      },
    });
    // Delivery confirmation: the SOURCE warehouse's team and the company
    // admin are notified that the destination scanned and received the lots —
    // the sender knows their shipment has landed.
    try {
      const { notifyWarehouseTeam, notifyAdmin } = require("../../services/notificationService");
      // Close the loop on stock requests: an accepted request whose linked
      // shipment was just received is now fulfilled.
      const TransferRequest = require("../../model/Transport/TransferRequest");
      await TransferRequest.updateMany(
        { companyId: req.user.companyId, shipmentId: req.params.id, status: "accepted" },
        { $set: { status: "fulfilled" } }
      );
      const lotsTxt = (r.shipment.lines || []).map((l) => `${l.lotNumber} ×${l.receivedQty ?? l.qty}`).join(", ");
      const msg = `${r.shipment.toLabel} received the transfer${lotsTxt ? ` (${lotsTxt})` : ""}${r.shortages ? ` with ${r.shortages} discrepancy(ies)` : " in full"}`;
      await notifyWarehouseTeam(req.user.companyId, r.shipment.fromWarehouseId, {
        title: "Transfer delivered", body: msg, payload: { shipmentId: r.shipment._id, kind: "transfer_received" },
      });
      await notifyAdmin(req.user.companyId, {
        title: "Transfer received", body: msg, payload: { shipmentId: r.shipment._id, kind: "transfer_received" },
      });
    } catch (notifyErr) { console.error("receipt notification failed:", notifyErr.message); }

    res.json({ success: true, message: r.shortages ? `Received with ${r.shortages} discrepancy(ies)` : "Received in full", data: { status: r.shipment.status, shortages: r.shortages } });
  } catch (e) { fail(res, e); }
};
exports.exception = async (req, res) => {
  try { const s = await shipmentService.reportException(req.user.companyId, req.params.id, { ...req.body, byUserId: req.user.id }); res.json({ success: true, data: { status: s.status } }); }
  catch (e) { fail(res, e); }
};
exports.deliver = async (req, res) => {
  try {
    const s = await shipmentService.completeDelivery(req.user.companyId, req.params.id, { verifierId: req.user.id, signedBy: req.body.signedBy, photoUrls: req.body.photoUrls || [], lat: req.body.lat, lng: req.body.lng });
    res.json({ success: true, message: "Delivered", data: { status: s.status } });
  } catch (e) { fail(res, e); }
};
exports.discrepancies = async (req, res) => { try { const r = await shipmentService.listDiscrepancies(req.user.companyId, req.query); res.json({ success: true, count: r.length, data: r }); } catch (e) { fail(res, e); } };

/* ---- driver mobile ---- */
exports.driverLogin = async (req, res) => {
  try { res.json({ success: true, data: await vehicleService.driverLogin(req.body) }); }
  catch (e) { fail(res, e); }
};
exports.myShipments = async (req, res) => {
  try { const r = await shipmentService.listForDriver(req.user.companyId, req.user.id); res.json({ success: true, count: r.length, data: r }); }
  catch (e) { fail(res, e); }
};
exports.driverArrived = async (req, res) => {
  try { const s = await shipmentService.markArrived(req.user.companyId, req.params.id, { driverId: req.user.id, lat: req.body.lat, lng: req.body.lng }); res.json({ success: true, data: { status: s.status } }); }
  catch (e) { fail(res, e); }
};
exports.driverDeliver = async (req, res) => {
  try {
    const photoUrls = (req.files || []).map((f) => `/uploads/${f.filename}`).concat(req.body.photoUrls || []);
    const s = await shipmentService.completeDelivery(req.user.companyId, req.params.id, { verifierId: req.user.id, signedBy: req.body.signedBy, photoUrls, lat: req.body.lat, lng: req.body.lng });
    res.json({ success: true, message: "Delivered", data: { status: s.status } });
  } catch (e) { fail(res, e); }
};
exports.driverException = async (req, res) => {
  try { const s = await shipmentService.reportException(req.user.companyId, req.params.id, { byUserId: req.user.id, note: req.body.note, lat: req.body.lat, lng: req.body.lng }); res.json({ success: true, data: { status: s.status } }); }
  catch (e) { fail(res, e); }
};
