const axios = require("axios");
const { decryptJSON } = require("../cryptoUtil");

/**
 * Shopify connector (Admin REST API). credentials (decrypted) = { shop, accessToken }.
 * shop is the *.myshopify.com domain. Inbound orders are normally received via
 * the orders/create webhook (verified by HMAC on the channel secret); pullOrders
 * is the reconciliation fallback.
 */
const API_VERSION = "2024-01";

function client(connection) {
  const creds = decryptJSON(connection.credentials);
  if (!creds?.shop || !creds?.accessToken) { const e = new Error("Shopify connection not configured"); e.status = 400; throw e; }
  return axios.create({
    baseURL: `https://${creds.shop}/admin/api/${API_VERSION}`,
    headers: { "X-Shopify-Access-Token": creds.accessToken, "content-type": "application/json" },
    timeout: 15000,
  });
}

/** Pull recent orders (since the stored cursor) and normalise to our shape. */
async function pullOrders(connection) {
  const api = client(connection);
  const since = connection.syncState?.ordersSince;
  const params = { status: "any", limit: 100 };
  if (since) params.updated_at_min = since;
  const { data } = await api.get("/orders.json", { params });
  return (data.orders || []).map((o) => ({
    externalId: `shopify-${o.id}`,
    soldAt: o.created_at,
    customer: { name: o.customer ? `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim() : undefined, phone: o.customer?.phone },
    lines: (o.line_items || []).map((li) => ({ sku: li.sku, qty: li.quantity, price: Number(li.price) })),
    payment: { mode: o.gateway, status: o.financial_status },
  }));
}

/** Push availableStock to Shopify inventory_levels for mapped locations. */
async function pushInventory(connection, items) {
  const api = client(connection);
  const results = [];
  for (const it of items) {
    // it = { inventory_item_id, location_id, available }
    try {
      await api.post("/inventory_levels/set.json", { location_id: it.location_id, inventory_item_id: it.inventory_item_id, available: it.available });
      results.push({ sku: it.sku, ok: true });
    } catch (err) {
      results.push({ sku: it.sku, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = { pullOrders, pushInventory, API_VERSION };
