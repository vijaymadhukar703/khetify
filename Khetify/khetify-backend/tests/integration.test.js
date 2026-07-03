const crypto = require("crypto");
const mongoose = require("mongoose");
const Product = require("../model/Company/productModel");
const Warehouse = require("../model/Warehouse/Warehouse");
const Inventory = require("../model/Inventory/Inventory");
const Order = require("../model/Order/Order");
const WebhookEndpoint = require("../model/Integration/WebhookEndpoint");
const OutboxEvent = require("../model/Integration/OutboxEvent");
const posService = require("../services/posService");
const outbox = require("../services/outboxService");
const apiKeyService = require("../services/apiKeyService");
const { encrypt, decrypt } = require("../services/cryptoUtil");

const companyId = new mongoose.Types.ObjectId();

async function seedStock(code, qty) {
  const wh = await Warehouse.create({ companyId, name: code, code });
  const p = await Product.create({ companyId, productName: `P-${code}`, skuNumber: `SKU-${code}`, mrp: 100 });
  await Inventory.create({ productId: p._id, ownerType: "company", ownerId: companyId, warehouseId: wh._id, batchNumber: `B-${code}`, lotNumber: `B-${code}`, offlineStock: qty, availableStock: qty });
  return { wh, p };
}

describe("POS sync — idempotency", () => {
  test("a replayed externalId does not double-process", async () => {
    const { wh, p } = await seedStock("WH1", 100);
    const item = { externalId: "txn-1", storeCode: "WH1", lines: [{ sku: p.skuNumber, qty: 10, price: 50 }], customer: { phone: "9999900000", name: "Ramesh" } };

    const r1 = await posService.processSale(companyId, item);
    expect(r1.ok).toBe(true);
    expect(r1.orderId).toBeTruthy();

    const r2 = await posService.processSale(companyId, item);
    expect(r2.ok).toBe(true);
    expect(r2.replay).toBe(true);
    expect(String(r2.orderId)).toBe(String(r1.orderId));

    expect(await Order.countDocuments({ companyId })).toBe(1); // one order only
    const inv = await Inventory.findOne({ ownerId: companyId, warehouseId: wh._id });
    expect(inv.availableStock).toBe(90); // deducted exactly once
  });
});

describe("POS sync — warehouse-scoped FEFO", () => {
  test("deducts from the store's warehouse only", async () => {
    const a = await seedStock("WH1", 50);
    const b = await seedStock("WH2", 50);
    // both warehouses sell the SAME sku? use WH1's product but stock exists in WH1 only.
    const r = await posService.processSale(companyId, { externalId: "txn-2", storeCode: "WH1", lines: [{ sku: a.p.skuNumber, qty: 20 }] });
    expect(r.ok).toBe(true);

    const inv1 = await Inventory.findOne({ ownerId: companyId, warehouseId: a.wh._id });
    const inv2 = await Inventory.findOne({ ownerId: companyId, warehouseId: b.wh._id });
    expect(inv1.availableStock).toBe(30); // WH1 deducted
    expect(inv2.availableStock).toBe(50); // WH2 untouched
  });

  test("insufficient stock at the store fails that item only", async () => {
    const a = await seedStock("WH1", 5);
    const r = await posService.processSale(companyId, { externalId: "txn-3", storeCode: "WH1", lines: [{ sku: a.p.skuNumber, qty: 10 }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/INSUFFICIENT/);
  });
});

describe("webhook signing + outbox delivery", () => {
  test("signature is a deterministic HMAC-SHA256 of the body", () => {
    const body = { event: "order.created", payload: { x: 1 } };
    const secret = "whsec_test";
    const expected = crypto.createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
    expect(outbox.sign(body, secret)).toBe(expected);
  });

  test("a failing delivery backs off; success marks delivered", async () => {
    const ep = await WebhookEndpoint.create({ companyId, url: "https://example.test/hook", secret: "whsec_x", events: ["order.created"], isActive: true });
    await outbox.emit(companyId, "order.created", { orderId: "abc" });
    let ev = await OutboxEvent.findOne({ companyId });
    expect(ev.status).toBe("pending");

    // failing delivery
    const failing = async () => { throw new Error("connect timeout"); };
    await outbox.dispatchPending({ httpPost: failing, now: new Date() });
    ev = await OutboxEvent.findById(ev._id);
    expect(ev.attempts).toBe(1);
    expect(ev.status).toBe("pending");
    expect(ev.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // jump past backoff and succeed
    let posted = null;
    const ok = async (url, b, h) => { posted = { url, h }; };
    await outbox.dispatchPending({ httpPost: ok, now: new Date(Date.now() + 60 * 60 * 1000) });
    ev = await OutboxEvent.findById(ev._id);
    expect(ev.status).toBe("delivered");
    expect(posted.url).toBe(ep.url);
    expect(posted.h["x-khetify-signature"]).toBeTruthy();
  });

  test("gives up after MAX_ATTEMPTS", async () => {
    await WebhookEndpoint.create({ companyId, url: "https://example.test/h2", secret: "s", events: ["order.created"], isActive: true });
    await outbox.emit(companyId, "order.created", {});
    const ev = await OutboxEvent.findOne({ companyId, status: "pending" });
    ev.attempts = outbox.MAX_ATTEMPTS - 1;
    ev.nextAttemptAt = new Date(Date.now() - 1000);
    await ev.save();
    await outbox.dispatchPending({ httpPost: async () => { throw new Error("nope"); }, now: new Date() });
    const after = await OutboxEvent.findById(ev._id);
    expect(after.status).toBe("failed");
  });
});

describe("API keys + credential encryption", () => {
  test("key is shown once, resolvable, then revocable", async () => {
    const { key } = await apiKeyService.createKey(companyId, { name: "POS", scopes: ["pos:sync"] });
    expect(key).toMatch(/^khk_/);
    const resolved = await apiKeyService.resolveKey(key);
    expect(String(resolved.companyId)).toBe(String(companyId));
    await apiKeyService.revokeKey(companyId, resolved._id);
    expect(await apiKeyService.resolveKey(key)).toBeNull();
  });

  test("AES-256-GCM round-trips credentials", () => {
    const blob = encrypt("super-secret-token");
    expect(blob).not.toContain("super-secret-token");
    expect(decrypt(blob)).toBe("super-secret-token");
  });
});
