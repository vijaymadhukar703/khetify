const { EventEmitter } = require("events");
let emitToCompany = () => {};
try { ({ emitToCompany } = require("../sockets")); } catch { /* sockets optional in tests */ }
const { notify } = require("./notificationService");

/**
 * Central event backbone. Domain services publish here; the bus fans out to
 * Socket.IO company rooms (live dashboards), the notification centre, and any
 * in-process subscribers. Adapted from the enterprise patch to coexist with
 * the existing direct socket emits.
 *
 *   publish("INVENTORY_MISMATCH", companyId, payload, { notifyMsg })
 *
 * Frontend listens on socket events "event" (catch-all) and `event:<NAME>`.
 */
const bus = new EventEmitter();
bus.setMaxListeners(50);

const EVENTS = [
  "LOT_RECEIVED", "INVENTORY_UPDATED", "INVENTORY_MISMATCH",
  "TRANSFER_RECEIVED", "SHIPMENT_DELIVERED", "ORDER_CREATED",
  "COST_CHANGE_REQUESTED", "COST_CHANGE_APPROVED",
];

async function publish(event, companyId, payload = {}, opts = {}) {
  const envelope = { event, companyId: String(companyId), at: new Date().toISOString(), ...payload };
  try {
    emitToCompany(companyId, "event", envelope);
    emitToCompany(companyId, `event:${event}`, envelope);
  } catch (e) { console.error("eventBus socket emit failed:", e.message); }

  if (opts.notifyMsg) {
    try {
      await notify({
        recipientType: "company",
        recipientId: companyId,
        type: event.toLowerCase(),
        title: opts.notifyTitle || event.replace(/_/g, " "),
        body: opts.notifyMsg,
        payload,
      });
    } catch (e) { console.error("eventBus notify failed:", e.message); }
  }

  bus.emit(event, envelope);
  bus.emit("*", envelope);
}

const subscribe = (event, handler) => bus.on(event, handler);

module.exports = { publish, subscribe, EVENTS };
