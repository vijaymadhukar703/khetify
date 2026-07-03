const crypto = require("crypto");
const axios = require("axios");
const WebhookEndpoint = require("../model/Integration/WebhookEndpoint");
const OutboxEvent = require("../model/Integration/OutboxEvent");

const MAX_ATTEMPTS = 8;

/** HMAC-SHA256 hex signature of the JSON body, used in x-khetify-signature. */
function sign(body, secret) {
  return crypto.createHmac("sha256", secret).update(typeof body === "string" ? body : JSON.stringify(body)).digest("hex");
}

/** Exponential backoff: 2^attempts minutes, capped at 6h. */
function backoffMs(attempts) {
  return Math.min(2 ** attempts, 360) * 60 * 1000;
}

/**
 * Emit an event to the outbox — one row per subscribed endpoint. Pass `session`
 * to enlist in the same transaction as the business change (transactional
 * outbox). No-op when no endpoint subscribes.
 */
async function emit(companyId, event, payload, session) {
  const endpoints = await WebhookEndpoint.find({ companyId, isActive: true, events: event }).session(session || null);
  if (!endpoints.length) return 0;
  const docs = endpoints.map((e) => ({ companyId, endpointId: e._id, event, payload, status: "pending", attempts: 0, nextAttemptAt: new Date() }));
  await OutboxEvent.create(docs, session ? { session } : {});
  return docs.length;
}

/**
 * Deliver due pending events. `httpPost(url, body, headers)` is injectable for
 * tests. On failure, backs off; after MAX_ATTEMPTS the event is marked failed.
 */
async function dispatchPending({ httpPost, now = new Date(), limit = 50 } = {}) {
  const post = httpPost || ((url, body, headers) => axios.post(url, body, { headers, timeout: 10000 }));
  const due = await OutboxEvent.find({ status: "pending", nextAttemptAt: { $lte: now } }).limit(limit);
  const endpointCache = new Map();
  let delivered = 0, failed = 0;

  for (const ev of due) {
    let endpoint = endpointCache.get(String(ev.endpointId));
    if (!endpoint) { endpoint = await WebhookEndpoint.findById(ev.endpointId); endpointCache.set(String(ev.endpointId), endpoint); }
    if (!endpoint || !endpoint.isActive) { ev.status = "failed"; ev.lastError = "endpoint missing/inactive"; await ev.save(); failed++; continue; }

    const body = { event: ev.event, payload: ev.payload, at: now.toISOString(), id: String(ev._id) };
    const headers = { "content-type": "application/json", "x-khetify-event": ev.event, "x-khetify-signature": sign(body, endpoint.secret) };
    try {
      await post(endpoint.url, body, headers);
      ev.status = "delivered";
      ev.deliveredAt = now;
      await ev.save();
      delivered++;
    } catch (err) {
      ev.attempts += 1;
      ev.lastError = String(err?.message || err).slice(0, 300);
      if (ev.attempts >= MAX_ATTEMPTS) ev.status = "failed";
      else ev.nextAttemptAt = new Date(now.getTime() + backoffMs(ev.attempts));
      await ev.save();
      failed++;
    }
  }
  return { processed: due.length, delivered, failed };
}

/** Send a one-off signed test ping to an endpoint. */
async function testPing(companyId, endpointId) {
  const endpoint = await WebhookEndpoint.findOne({ _id: endpointId, companyId });
  if (!endpoint) { const e = new Error("Endpoint not found"); e.status = 404; throw e; }
  const body = { event: "ping", payload: { ok: true }, at: new Date().toISOString() };
  const headers = { "content-type": "application/json", "x-khetify-event": "ping", "x-khetify-signature": sign(body, endpoint.secret) };
  await axios.post(endpoint.url, body, { headers, timeout: 10000 });
  return true;
}

module.exports = { emit, dispatchPending, testPing, sign, MAX_ATTEMPTS, backoffMs };
