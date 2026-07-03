const Notification = require("../model/Notification/Notification");
const { emitToCompany, emitToSeller } = require("../sockets");

/**
 * Create a notification and push it in realtime to the recipient.
 */
async function notify({ recipientType, recipientId, type, title, body, payload }) {
  const doc = await Notification.create({
    recipientType,
    recipientId,
    type,
    title,
    body,
    payload,
  });

  if (recipientType === "company") {
    emitToCompany(recipientId, "notification:new", doc);
  } else if (recipientType === "seller") {
    emitToSeller(recipientId, "notification:new", doc);
  }

  return doc;
}

module.exports = { notify };

/**
 * Notify every active user assigned to a warehouse (per-user inbox rows) AND
 * the company admin (company inbox). Used for transfer requests, decisions,
 * and delivery confirmations so the source warehouse, the destination
 * warehouse and the admin all stay in the loop.
 */
async function notifyWarehouseTeam(companyId, warehouseId, { type = "shipment", title, body, payload }) {
  const User = require("../model/User/User");
  const users = warehouseId
    ? await User.find({ companyId, warehouseIds: warehouseId, status: "active" }).select("_id")
    : [];
  await Promise.all(
    users.map((u) => notify({ recipientType: "warehouse_manager", recipientId: u._id, type, title, body, payload }).catch(() => {}))
  );
}

async function notifyAdmin(companyId, { type = "shipment", title, body, payload }) {
  await notify({ recipientType: "company", recipientId: companyId, type, title, body, payload }).catch(() => {});
}

module.exports.notifyWarehouseTeam = notifyWarehouseTeam;
module.exports.notifyAdmin = notifyAdmin;
