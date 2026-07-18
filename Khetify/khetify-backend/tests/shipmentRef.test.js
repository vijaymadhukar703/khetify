/**
 * The shipment reference shown in the Shipments list.
 *
 * There is no stored reference column — `SH-<last 6 of _id>` is derived, with a
 * carrier LR number winning when one exists. shipmentService.shipmentRef is the
 * single definition; these tests pin that the Shipments list emits it and that it
 * MATCHES what Transfer History shows for the same shipment, since matching a row
 * across the two views is the entire point of the column.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Shipment = require("../model/Transport/Shipment");
const svc = require("../services/shipmentService");
const orderCtrl = require("../controller/Order/orderController");

let companyId, indore, bhopal, productId;

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

beforeEach(async () => {
  const c = await Company.create({ fullName: "Aakash", email: `s-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = c._id;
  indore = await Warehouse.create({ companyId, name: "Indore Warehouse", code: "IND" });
  bhopal = await Warehouse.create({ companyId, name: "Bhopal Warehouse", code: "BPL" });
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "U1" });
  productId = p._id;
});

/** Mirrors the reported shipment: Bhopal Warehouse → Indore Warehouse. */
const makeShipment = (over = {}) =>
  Shipment.create({
    companyId, ownerType: "company", ownerId: companyId,
    refType: "TransferRequest", fromWarehouseId: bhopal._id, fromLabel: "Bhopal Warehouse",
    toType: "warehouse", toWarehouseId: indore._id, toLabel: "Indore Warehouse",
    lines: [{ productId, qty: 100 }], status: "received",
    ...over,
  });

const expectedRef = (s) => `SH-${String(s._id).slice(-6).toUpperCase()}`;

describe("shipmentRef()", () => {
  test("derives SH-<last 6 of _id>, upper-cased", async () => {
    const s = await makeShipment();
    expect(svc.shipmentRef(s)).toBe(expectedRef(s));
    expect(svc.shipmentRef(s)).toMatch(/^SH-[0-9A-F]{6}$/);
  });

  test("a carrier LR number wins when present", async () => {
    const s = await makeShipment({ lrNumber: "LR-9931" });
    expect(svc.shipmentRef(s)).toBe("LR-9931");
  });

  test("is stable across calls — the same shipment always reads the same ref", async () => {
    const s = await makeShipment();
    expect(svc.shipmentRef(s)).toBe(svc.shipmentRef(s));
  });
});

describe("listShipments() emits the ref", () => {
  test("every row carries its exact reference", async () => {
    const s = await makeShipment();
    const [row] = await svc.listShipments(companyId);
    expect(row.ref).toBe(expectedRef(s));
  });

  test("existing fields are passed through untouched (additive only)", async () => {
    await makeShipment({ vehicleNo: "MP09-1234" });
    const [row] = await svc.listShipments(companyId);
    expect(row).toMatchObject({
      fromLabel: "Bhopal Warehouse",
      toLabel: "Indore Warehouse",
      toType: "warehouse",     // still drives the Type column
      refType: "TransferRequest",
      status: "received",
      vehicleNo: "MP09-1234",
    });
    expect(row._id).toBeDefined();
    expect(row.lines).toHaveLength(1);
  });

  test("warehouse scoping still applies — the ref never widens the list", async () => {
    await makeShipment();
    const other = await Warehouse.create({ companyId, name: "Katni", code: "KAT" });
    expect(await svc.listShipments(companyId, { warehouseIds: [other._id] })).toHaveLength(0);
    expect(await svc.listShipments(companyId, { warehouseIds: [indore._id] })).toHaveLength(1);
  });
});

describe("From / To resolve to real warehouse names, never a flow label", () => {
  test("a transfer whose stored toLabel is the flow text still lists the real warehouses", async () => {
    // Exactly how transferRequestController/sellerTransferService build it when
    // their warehouse lookup came back empty: `${toWh?.name || "Warehouse"} (…)`.
    await makeShipment({ toLabel: "Warehouse (transfer)" });

    const [row] = await svc.listShipments(companyId);

    expect(row.fromName).toBe("Bhopal Warehouse");
    expect(row.toName).toBe("Indore Warehouse"); // NOT "Warehouse (transfer)"
    expect(row.toName).not.toMatch(/transfer|stock request|supply/i);
  });

  test("the decorated stock-request label never reaches the To column", async () => {
    await makeShipment({ toLabel: "Indore Warehouse (stock request)" });
    const [row] = await svc.listShipments(companyId);
    expect(row.toName).toBe("Indore Warehouse"); // suffix stripped by using the relation
  });

  test("a customer shipment keeps its label — there is no warehouse to resolve", async () => {
    await makeShipment({ toType: "customer", toWarehouseId: null, toLabel: "Ramesh Traders", refType: "Order" });
    const [row] = await svc.listShipments(companyId);
    expect(row.toName).toBe("Ramesh Traders");
  });

  test("a warehouse transfer with an unresolvable destination reads — , not the flow label", async () => {
    await makeShipment({ toWarehouseId: new mongoose.Types.ObjectId(), toLabel: "Warehouse (stock request)" });
    const [row] = await svc.listShipments(companyId);
    expect(row.toName).toBe("—");
  });

  test("the resolved names match what Transfer History shows for the same shipment", async () => {
    const s = await makeShipment({ toLabel: "Warehouse (transfer)" });

    const [listRow] = await svc.listShipments(companyId);
    const res = mockRes();
    await orderCtrl.getHistory({ query: { excludeRequests: "1" }, user: { id: companyId, companyId, role: "company_admin" } }, res);
    const historyRow = res.body.data.find((r) => String(r.id) === String(s._id));

    expect(listRow.fromName).toBe(historyRow.from);
    expect(listRow.toName).toBe(historyRow.to);
  });
});

describe("the list ref matches Transfer History", () => {
  test("same shipment → identical ref in both views", async () => {
    const s = await makeShipment();

    const [listRow] = await svc.listShipments(companyId);
    const res = mockRes();
    await orderCtrl.getHistory({ query: { excludeRequests: "1" }, user: { id: companyId, companyId, role: "company_admin" } }, res);
    const historyRow = res.body.data.find((r) => String(r.id) === String(s._id));

    expect(listRow.ref).toBe(historyRow.ref);
    expect(listRow.ref).toBe(expectedRef(s));
  });
});
