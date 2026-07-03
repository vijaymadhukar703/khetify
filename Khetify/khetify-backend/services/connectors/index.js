const shopify = require("./shopify");

/** Documented stub for connectors not yet implemented. */
function notImplemented(channel) {
  const make = (fn) => async () => {
    const e = new Error(`${channel}.${fn}() is not implemented yet`);
    e.status = 501;
    throw e;
  };
  return { pullOrders: make("pullOrders"), pushInventory: make("pushInventory"), _stub: true };
}

/*
 * TODO: implement these connectors (each: pullOrders + pushInventory):
 *  - woocommerce: WooCommerce REST API v3 (consumerKey/Secret); orders webhook + products/{id} stock_quantity.
 *  - amazon:      SP-API (LWA + AWS SigV4); Orders API pull + Listings/FBA inventory feeds.
 *  - flipkart:    Flipkart Marketplace API (OAuth); /orders/shipments + /listings stock update.
 */
const REGISTRY = {
  shopify,
  woocommerce: notImplemented("woocommerce"),
  amazon: notImplemented("amazon"),
  flipkart: notImplemented("flipkart"),
};

function getConnector(channel) {
  const c = REGISTRY[channel];
  if (!c) { const e = new Error(`Unknown channel: ${channel}`); e.status = 400; throw e; }
  return c;
}

module.exports = { getConnector, REGISTRY };
