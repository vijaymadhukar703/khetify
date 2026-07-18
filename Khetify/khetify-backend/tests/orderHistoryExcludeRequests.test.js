/**
 * GET /api/orders/history — the ?excludeRequests=1 projection.
 *
 * A warehouse-to-warehouse move is stored as TWO records: the TransferRequest
 * that authorises it (TR-*) and the Shipment raised when it is fulfilled
 * (SH-*). Transfer History (Main Company + Company Warehouse) lists physical
 * stock movements, so it asks for the shipment only; the request keeps its own
 * home in Operations → Shipment Tracking & Transfers → Requests.
 *
 * Order History (every other role) sends no flag and must still see both.
 */
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const TransferRequest = require("../model/Transport/TransferRequest");
const Shipment = require("../model/Transport/Shipment");
const lotService = require("../services/lotService");
const trCtrl = require("../controller/Transport/transferRequestController");
const orderCtrl = require("../controller/Order/orderController");

let companyId, productId, source, requester;

/** Minimal express-style res mock. */
function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const adminUser = () => ({ id: companyId, companyId, role: "company_admin" });
const opsUser = () => ({ id: new mongoose.Types.ObjectId(), companyId, role: "operations_manager" });

const history = async (query, user = adminUser()) => {
  const res = mockRes();
  await orderCtrl.getHistory({ query, user }, res);
  return res.body;
};
const refs = (body) => (body.data || []).map((r) => r.ref);

beforeEach(async () => {
  const company = await Company.create({ fullName: "Hist Co", email: `h-${new mongoose.Types.ObjectId()}@x.com`, password: "x" });
  companyId = company._id;
  source = await Warehouse.create({ companyId, name: "Indore Warehouse", code: "IND" });
  requester = await Warehouse.create({ companyId, name: "Bhopal Warehouse", code: "BHO" });
  const p = await Product.create({ companyId, productName: "Urea", skuNumber: "UR", price: 10 });
  productId = p._id;
});

/** Drive the real flow: stock at the source, a request, then an accept that
 *  FEFO-picks and raises the linked shipment. Returns both records. */
async function requestAndFulfil(qty = 100) {
  await lotService.receiveLot({ ownerId: companyId, productId, warehouseId: source._id, batchNumber: "L1", qty });
  const request = await TransferRequest.create({
    companyId, productId, fromWarehouseId: source._id, toWarehouseId: requester._id,
    qty, requestedBy: new mongoose.Types.ObjectId(),
  });
  const res = mockRes();
  await trCtrl.accept({ params: { id: request._id }, body: {}, user: opsUser() }, res);
  expect(res.statusCode).toBe(200); // the accept must really have happened
  const shipment = await Shipment.findOne({ companyId, refId: request._id });
  expect(shipment).toBeTruthy();
  return { request, shipment };
}

describe("order history — excludeRequests", () => {
  test("default (Order History) still lists BOTH the request and the shipment", async () => {
    const { request, shipment } = await requestAndFulfil();

    const body = await history({});

    expect(refs(body)).toEqual(expect.arrayContaining([
      `TR-${String(request._id).slice(-6).toUpperCase()}`,
      shipment.lrNumber || `SH-${String(shipment._id).slice(-6).toUpperCase()}`,
    ]));
  });

  test("excludeRequests=1 (Transfer History) lists the shipment only — one row per movement", async () => {
    const { request, shipment } = await requestAndFulfil();

    const body = await history({ excludeRequests: "1" });

    expect(refs(body)).toEqual([
      shipment.lrNumber || `SH-${String(shipment._id).slice(-6).toUpperCase()}`,
    ]);
    expect(refs(body)).not.toContain(`TR-${String(request._id).slice(-6).toUpperCase()}`);
    expect(body.data.every((r) => r.kind !== "transfer")).toBe(true);
  });

  test("a request with no shipment yet is excluded too — it is not a movement", async () => {
    await TransferRequest.create({
      companyId, productId, fromWarehouseId: source._id, toWarehouseId: requester._id,
      qty: 5, requestedBy: new mongoose.Types.ObjectId(),
    });

    expect(await history({ excludeRequests: "1" })).toMatchObject({ count: 0, data: [] });
    expect((await history({})).count).toBe(1); // still visible to Order History
  });

  test("the surviving shipment row keeps the fields Transfer History renders", async () => {
    const { shipment } = await requestAndFulfil(100);

    const [row] = (await history({ excludeRequests: "1" })).data;

    expect(row).toMatchObject({
      kind: "shipment",
      toType: "warehouse", // drives the "Transfer" label via movementKind()
      from: "Indore Warehouse",
      to: "Bhopal Warehouse",
      units: 100,
    });
    expect(String(row.id)).toBe(String(shipment._id));
  });

  test("excluding requests does not disturb the value total (was double-counted)", async () => {
    await requestAndFulfil(100); // 100 units @ price 10

    const withRequests = await history({});
    const movementsOnly = await history({ excludeRequests: "1" });

    const sum = (b) => (b.data || []).reduce((s, r) => s + (r.total || 0), 0);
    expect(sum(withRequests)).toBe(2000); // TR 1000 + SH 1000 — the same goods twice
    expect(sum(movementsOnly)).toBe(1000); // counted once
  });
});
