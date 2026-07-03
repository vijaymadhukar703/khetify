const mongoose = require("mongoose");
const SupplyOrder = require("../../model/Supply/SupplyOrder");
const UnitSerial = require("../../model/Barcode/UnitSerial");
const Location = require("../../model/Warehouse/Location");
const Warehouse = require("../../model/Warehouse/Warehouse");
const Inventory = require("../../model/Inventory/Inventory");
const Shipment = require("../../model/Transport/Shipment");
const lotService = require("../../services/lotService");
const barcodeService = require("../../services/barcodeService");
const shipmentService = require("../../services/shipmentService");
const locationService = require("../../services/locationService");
const { assertCompanyWarehouse } = require("../../services/warehouseOwnershipService");
const { notify, notifyWarehouseTeam } = require("../../services/notificationService");

// Stage → the supply-order statuses that belong in each Send Stock tab.
const STAGE_STATUSES = {
  pick: ["approved", "picking"],
  pack: ["picked", "packing"],
  dispatch: ["packed"],
};

/** POST /api/supply-order  — seller (or company on behalf) requests bulk supply. */
exports.createSupplyOrder = async (req, res) => {
  try {
    const { sellerId, items, notes } = req.body;
    if (!sellerId || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "sellerId and non-empty items[] are required" });
    }
    const order = await SupplyOrder.create({
      sellerId,
      companyId: req.user.companyId,
      items,
      notes,
      status: "requested",
    });
    await notify({
      recipientType: "company",
      recipientId: req.user.id,
      type: "supply_status",
      title: "New supply request",
      body: "A seller has requested bulk supply.",
      payload: { supplyOrderId: order._id },
    });
    res.status(201).json({ success: true, message: "Supply order created", data: order });
  } catch (err) {
    console.error("createSupplyOrder error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/supply-order — company sees its own incoming requests, enriched
 * with seller business name, product names and warehouses for the UI. Includes
 * `pendingCount` (status "requested") for the Home widget.
 *
 * `?stage=pick|pack|dispatch` narrows to the Send Stock tab's statuses so the
 * warehouse picks/packs/dispatches APPROVED SUPPLY directly (no wave). */
exports.getSupplyOrders = async (req, res) => {
  try {
    const filter = { companyId: req.user.companyId };
    const stageStatuses = STAGE_STATUSES[req.query.stage];
    if (stageStatuses) filter.status = { $in: stageStatuses };

    const rows = await SupplyOrder.find(filter)
      .sort({ createdAt: -1 })
      .populate({ path: "sellerId", model: "Seller", select: "sellerInfo.businessName" })
      .populate({ path: "items.productId", select: "productName skuNumber unit" })
      .populate({ path: "warehouseId", select: "name code address" })
      .populate({ path: "sourceWarehouseId", select: "name code" });
    const pendingCount = rows.filter((r) => r.status === "requested").length;
    res.json({ success: true, count: rows.length, pendingCount, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/supply-order/:id/source-options
 * Per (company) warehouse availability for THIS order's items, so "Assign a
 * source warehouse" can show how much of each requested product a warehouse
 * actually has and block ones that can't fulfill. `availableQty` sums
 * availableStock across NON-EXPIRED lots — exactly what approval FEFO-reserves.
 */
exports.getSourceOptions = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId })
      .populate({ path: "items.productId", select: "productName" });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });

    const now = new Date();
    const productIds = (order.items || []).map((it) => new mongoose.Types.ObjectId(String(it.productId?._id || it.productId)));
    const warehouses = await Warehouse.find({ companyId }).select("name code").sort({ name: 1 });

    // Sum available, non-expired stock per (warehouse, product) in one pass.
    const agg = await Inventory.aggregate([
      {
        $match: {
          ownerType: "company",
          ownerId: new mongoose.Types.ObjectId(String(companyId)),
          productId: { $in: productIds },
          $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }],
        },
      },
      { $group: { _id: { wh: "$warehouseId", product: "$productId" }, available: { $sum: "$availableStock" } } },
    ]);
    const key = (wh, prod) => `${wh}|${prod}`;
    const avail = new Map(agg.map((r) => [key(r._id.wh, r._id.product), r.available]));

    const data = warehouses.map((w) => {
      const items = (order.items || []).map((it) => {
        const pid = String(it.productId?._id || it.productId);
        return {
          productId: pid,
          productName: it.productId?.productName || "Item",
          requiredQty: it.quantity,
          availableQty: avail.get(key(w._id, pid)) || 0,
        };
      });
      return { warehouseId: w._id, name: w.name, code: w.code || null, items, canFulfill: items.every((i) => i.availableQty >= i.requiredQty) };
    });
    // Fulfilling warehouses first, then by name.
    data.sort((a, b) => (b.canFulfill ? 1 : 0) - (a.canFulfill ? 1 : 0) || String(a.name).localeCompare(String(b.name)));

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/** GET /api/supply-order/pending-count — number of requests awaiting action
 * (drives the company Home "Supply requests" banner). */
exports.getPendingCount = async (req, res) => {
  try {
    const pendingCount = await SupplyOrder.countDocuments({ companyId: req.user.companyId, status: "requested" });
    res.json({ success: true, data: { pendingCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PUT /api/supply-order/:id/status  { status, shipment? }
 * On "approved": runs the two-sided transfer (company stock out, seller stock in)
 * inside a transaction so a partial failure rolls back.
 */
exports.updateSupplyStatus = async (req, res) => {
  try {
    const { status, shipment, sourceWarehouseId } = req.body;
    const order = await SupplyOrder.findOne({
      _id: req.params.id,
      companyId: req.user.companyId,
    });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });

    if (status === "approved" && order.status !== "approved") {
      // Approval ASSIGNS A SOURCE WAREHOUSE and ALLOCATES (reserves) stock from
      // it — exactly like confirming a customer order. The reserved supply then
      // surfaces in SEND STOCK, where Operations picks, packs and prints a
      // shipping label. The cross-owner shipment is created at DISPATCH (after
      // the label), not here. Nothing physically leaves the warehouse yet.
      if (!order.warehouseId) {
        return res.status(400).json({ success: false, message: "Destination warehouse missing on the supply order" });
      }
      const src = sourceWarehouseId || order.sourceWarehouseId;
      if (!src) {
        return res.status(400).json({ success: false, message: "Assign a source warehouse to approve this supply" });
      }
      await assertCompanyWarehouse(order.companyId, src);

      // FEFO-reserve each item from the assigned source warehouse only. Throws
      // 409 INSUFFICIENT_STOCK if a warehouse can't cover an item (nothing is
      // reserved for any item in that case — each allocateFEFO is atomic).
      for (const item of order.items) {
        item.allocations = await lotService.allocateFEFO({
          ownerType: "company", ownerId: order.companyId, warehouseId: src,
          productId: item.productId, qty: item.quantity, refType: "SupplyOrder", refId: order._id, performedBy: req.user.id,
        });
      }
      order.markModified("items");
      order.sourceWarehouseId = src;
      order.status = "approved";
      await order.save();

      // Tell the source warehouse's operations team to pick/pack in Send Stock.
      await notifyWarehouseTeam(order.companyId, src, {
        type: "supply_status", title: "Supply ready to pick in Send Stock",
        body: "An approved seller supply is reserved — pick, pack and dispatch it from Send Stock.",
        payload: { supplyOrderId: order._id, kind: "supply_ready" },
      }).catch(() => {});
      await notify({
        recipientType: "seller", recipientId: order.sellerId, type: "supply_status",
        title: "Request accepted", body: "Your supply request was accepted and is being prepared for dispatch.",
        payload: { supplyOrderId: order._id, status: "approved" },
      }).catch(() => {});

      return res.json({ success: true, message: "Approved — stock reserved, ready to pick in Send Stock", data: order });
    }

    order.status = status || order.status;
    if (shipment) order.shipment = { ...order.shipment, ...shipment };
    await order.save();

    await notify({
      recipientType: "seller",
      recipientId: order.sellerId,
      type: "supply_status",
      title: "Supply order updated",
      body: `Your supply order is now: ${order.status}.`,
      payload: { supplyOrderId: order._id, status: order.status },
    });

    res.json({ success: true, message: "Status updated", data: order });
  } catch (err) {
    console.error("updateSupplyStatus error:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });

/**
 * POST /api/supply-order/:id/pick  { picks: [{ productId, qty, serials?, binCode? }] }
 * Direct scan-pick straight against the order's reserved allocations — NO
 * PickList, NO wave. Labeled units transition in_stock → picked and are recorded
 * on their allocation (lot-accurate). Owned stock is NOT deducted here; it stays
 * reserved until dispatch commits it.
 */
exports.pickSupplyOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const performedBy = req.user.id;
    const { picks } = req.body;
    if (!Array.isArray(picks) || !picks.length) return res.status(400).json({ success: false, message: "picks[] are required" });

    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });
    if (!["approved", "picking"].includes(order.status)) return res.status(409).json({ success: false, message: `Cannot pick a ${order.status} supply order` });

    for (const pick of picks) {
      const item = (order.items || []).find((it) => String(it.productId) === String(pick.productId));
      if (!item) return res.status(400).json({ success: false, message: `Product ${pick.productId} is not on this supply order` });
      const allocByInv = new Map((item.allocations || []).map((a) => [String(a.inventoryId), a]));

      let pickQty;
      if (Array.isArray(pick.serials) && pick.serials.length) {
        const units = await UnitSerial.find({ companyId, serial: { $in: pick.serials } });
        const bySerial = new Map(units.map((u) => [u.serial, u]));
        for (const s of pick.serials) {
          const u = bySerial.get(s);
          if (!u) return res.status(409).json({ success: false, message: `Unknown serial ${s}` });
          if (!allocByInv.has(String(u.inventoryId))) return res.status(409).json({ success: false, message: `Serial ${s} is not from this order's reserved lots` });
          if (u.status !== "in_stock") return res.status(409).json({ success: false, message: `Serial ${s} is ${u.status}, cannot pick` });
        }
        await barcodeService.transitionUnits(companyId, pick.serials, { toStatus: "picked", event: "picked", refType: "SupplyOrder", refId: order._id, actorId: performedBy });
        // Record each serial on its lot's allocation so dispatch can ship it.
        for (const s of pick.serials) {
          const a = allocByInv.get(String(bySerial.get(s).inventoryId));
          a.serials = a.serials || [];
          if (!a.serials.includes(s)) a.serials.push(s);
        }
        pickQty = pick.serials.length;
      } else {
        pickQty = Number(pick.qty);
        if (!pickQty || pickQty <= 0) return res.status(400).json({ success: false, message: "Each pick needs serials or a positive qty" });
      }

      // Optional: decrement the physical pick-face bin (stock leaves the bin into
      // staging; owned Inventory totals stay reserved until dispatch commits).
      if (pick.binCode) {
        const loc = await Location.findOne({ companyId, fullCode: String(pick.binCode).toUpperCase() });
        const inventoryId = item.allocations?.[0]?.inventoryId;
        if (loc && inventoryId) {
          await locationService.moveBinStock({ companyId, fromLocationId: loc._id, toLocationId: null, inventoryId, qty: pickQty, performedBy }).catch(() => {});
        }
      }

      item.pickedQty = Math.min(item.quantity, (item.pickedQty || 0) + pickQty);
    }

    order.markModified("items");
    order.status = (order.items || []).every((it) => (it.pickedQty || 0) >= it.quantity) ? "picked" : "picking";
    await order.save();
    res.json({ success: true, message: order.status === "picked" ? "Picked in full" : "Picked", data: order });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/supply-order/:id/pack
 * Pack the picked units: transition the order's picked serials → packed and set
 * packedQty. status → "packed" when every item is fully packed, else "packing".
 */
exports.packSupplyOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const performedBy = req.user.id;
    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });
    if (!["picked", "picking", "packing"].includes(order.status)) return res.status(409).json({ success: false, message: `Cannot pack a ${order.status} supply order` });

    const serials = (order.items || []).flatMap((it) => (it.allocations || []).flatMap((a) => a.serials || []));
    if (serials.length) {
      await barcodeService.transitionUnits(companyId, serials, { toStatus: "packed", event: "packed", refType: "SupplyOrder", refId: order._id, actorId: performedBy, force: true });
    }
    for (const it of order.items || []) it.packedQty = it.pickedQty || 0;
    order.markModified("items");
    order.status = (order.items || []).every((it) => (it.packedQty || 0) >= it.quantity) ? "packed" : "packing";
    await order.save();
    res.json({ success: true, message: order.status === "packed" ? "Packed in full" : "Packed", data: order });
  } catch (err) { fail(res, err); }
};

/** Build the cross-owner shipment lines from the order's reserved allocations. */
function manifestLines(order) {
  const lines = [];
  for (const it of order.items || []) {
    for (const a of it.allocations || []) {
      lines.push({ inventoryId: a.inventoryId, productId: it.productId?._id || it.productId, lotNumber: a.lotNumber, batchNumber: a.batchNumber, qty: a.qty ?? a.quantity });
    }
  }
  return lines;
}

/**
 * GET /api/supply-order/:id/manifest
 * Idempotently ensure a PLANNED cross-owner Shipment (with a stable manifest
 * token) exists for this supply order, so the printed Shipping Label can carry
 * a REAL scannable barcode of the payload BEFORE dispatch. Reuses the existing
 * shipment if already created (token stays stable through dispatch & receipt).
 */
exports.getManifest = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId })
      .populate({ path: "sellerId", model: "Seller", select: "sellerInfo.businessName" })
      .populate({ path: "warehouseId", select: "name code" })
      .populate({ path: "items.productId", select: "productName skuNumber" });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });

    let shipment = order.shipmentId ? await Shipment.findOne({ _id: order.shipmentId, companyId }) : null;
    if (!shipment) {
      if (!order.sourceWarehouseId) return res.status(400).json({ success: false, message: "Approve & assign a source warehouse first" });
      const lines = manifestLines(order);
      if (!lines.length) return res.status(400).json({ success: false, message: "Nothing reserved — approve to allocate first" });
      shipment = await shipmentService.createShipment(companyId, {
        refType: "SupplyOrder", refId: order._id,
        fromWarehouseId: order.sourceWarehouseId, toType: "seller", toOwnerType: "seller", toOwnerId: order.sellerId,
        toWarehouseId: order.warehouseId, toLabel: `${order.sellerId?.sellerInfo?.businessName || "Seller"} (supply)`,
        lines, performedBy: req.user.id,
      });
      shipment.qrToken = shipmentService._internal.qrFor(shipment._id);
      await shipment.save();
      order.shipmentId = shipment._id;
      await order.save();
    } else if (!shipment.qrToken) {
      shipment.qrToken = shipmentService._internal.qrFor(shipment._id);
      await shipment.save();
    }

    res.json({
      success: true,
      data: {
        shipmentId: shipment._id,
        qrPayload: `${shipment._id}.${shipment.qrToken}`,
        seller: order.sellerId?.sellerInfo?.businessName || "Seller",
        destinationWarehouse: order.warehouseId?.name || null,
        items: (order.items || []).map((it) => ({ productName: it.productId?.productName || "Item", quantity: it.quantity })),
      },
    });
  } catch (err) { fail(res, err); }
};

/**
 * POST /api/supply-order/:id/dispatch  { labelPrinted, vehicleNo?, transporter?, driver?, driverPhone? }
 * Requires the label to have been printed and a planned shipment to exist (from
 * /manifest). Persists the transport details, then finalizes the shipment via
 * shipmentService.dispatchShipment — which commits the reservation (source
 * stock leaves, supply_out ledger), keeps the SAME manifest token, sends the
 * units in-transit, sets the shipment in_transit and notifies the seller.
 */
exports.dispatchSupplyOrder = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { labelPrinted, vehicleNo, transporter, driver, driverName, driverPhone } = req.body;
    const order = await SupplyOrder.findOne({ _id: req.params.id, companyId });
    if (!order) return res.status(404).json({ success: false, message: "Supply order not found" });
    if (["dispatched", "in_transit", "arrived", "received", "partially_received", "delivered"].includes(order.status)) {
      return res.status(409).json({ success: false, message: `Supply order already ${order.status}` });
    }
    if (labelPrinted !== true) return res.status(409).json({ success: false, message: "Print the shipping label before dispatch" });
    if (!order.shipmentId) return res.status(409).json({ success: false, message: "Print the shipping label first to create the manifest" });

    // Persist transport details onto the planned shipment.
    await Shipment.updateOne({ _id: order.shipmentId, companyId }, { $set: { vehicleNo, transporter, driverName: driver || driverName, driverPhone } });

    // Commit + finalize: deducts source, keeps token, units → in-transit.
    await shipmentService.dispatchShipment(companyId, order.shipmentId, { performedBy: req.user.id });

    order.status = "dispatched";
    await order.save();
    res.json({ success: true, message: "Dispatched — supply in transit", data: { shipmentId: order.shipmentId } });
  } catch (err) { fail(res, err); }
};
