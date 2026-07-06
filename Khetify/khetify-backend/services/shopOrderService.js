const mongoose = require("mongoose");
const Order = require("../model/Order/Order");
const Customer = require("../model/Sales/Customer");
const Consumer = require("../model/Shop/Consumer");
const catalog = require("./shopCatalogService");
const customerService = require("./customerService");
const tax = require("./taxService");
const { nextSeq } = require("./counterService");

/**
 * Storefront (customer-shop) checkout + order history.
 *
 * A single cart may contain listings from several sellers, so checkout SPLITS
 * the cart into one Order per seller (Amazon/Flipkart style). Each order is
 * created under that seller's owner scope (ownerType "seller", ownerId), with
 * salesChannel "website" and status "pending" — it lands in the seller's
 * existing outbound-orders queue for them to accept and fulfil. We do NOT
 * reserve FEFO stock at checkout (that is the seller's accept step); this keeps
 * checkout from failing on a listing whose lot inventory isn't synced yet.
 *
 * For each (consumer, seller) pair we upsert a Sales/Customer CRM record so the
 * seller sees a real customer with contact + shipping details.
 */

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Gapless website order number per seller: WEB-<sellerSeq>. */
async function nextWebOrderNumber(sellerId) {
  const seq = await nextSeq(sellerId, "web-order");
  return `WEB-${String(seq).padStart(5, "0")}`;
}

/** Find-or-create the seller-scoped Customer for this consumer (dedup on phone,
 * else email, else create a phone-less record). Keeps the shipping address fresh. */
async function upsertSellerCustomer(sellerId, consumer, shipAddr) {
  const ownerType = "seller";
  const ownerId = sellerId;
  const phone = consumer.phone || shipAddr?.phone;

  let customer = null;
  if (phone) customer = await Customer.findOne({ ownerType, ownerId, phone });
  if (!customer && consumer.email) customer = await Customer.findOne({ ownerType, ownerId, email: consumer.email });

  const crmAddress = shipAddr
    ? [{
        label: shipAddr.label || "Shipping",
        line1: [shipAddr.line1, shipAddr.line2].filter(Boolean).join(", "),
        city: shipAddr.city,
        district: shipAddr.district,
        state: shipAddr.state,
        stateCode: shipAddr.stateCode,
        pincode: shipAddr.pincode,
        isDefault: true,
      }]
    : [];

  if (customer) {
    if (crmAddress.length) customer.addresses = crmAddress;
    customer.email = customer.email || consumer.email;
    await customer.save();
    return customer;
  }

  // Reuse the shared customer service so the seller's CUST-#### numbering stays
  // consistent with customers they create themselves (key "cust-seller").
  return customerService.createCustomer(
    { ownerType, ownerId },
    {
      name: shipAddr?.fullName || consumer.name,
      type: "retail",
      phone,
      email: consumer.email,
      addresses: crmAddress,
    }
  );
}

/** Compute priced/taxed line items for one seller's slice of the cart. */
function buildLines(cartItems, resolved) {
  const lines = [];
  let totalUnits = 0, totalAmount = 0;
  for (const ci of cartItems) {
    const r = resolved.get(String(ci.listingId));
    if (!r) throw httpErr("A product in your cart is no longer available", 409);
    const qty = Math.max(1, Number(ci.qty) || 1);
    // Only published + in-stock products may be ordered.
    if (!(r.availableStock > 0)) throw httpErr(`"${r.name}" is out of stock`, 409);
    if (qty > r.availableStock) throw httpErr(`Only ${r.availableStock} unit(s) of "${r.name}" are available`, 409);
    const price = r.price;
    // The customer total is price × qty ONLY — the marketplace price (MRP) is
    // treated as tax-inclusive, so no GST is ADDED on top. This keeps cart,
    // checkout, order-success and order-history totals identical. We record the
    // gstRate/hsn on the line (informational, zero added amounts) so the seller
    // can still show an inclusive-GST breakup on their own invoice.
    const taxable = qty * price;
    totalUnits += qty;
    totalAmount += taxable;
    lines.push({
      productId: r.productId,
      name: r.name,
      qty,
      price,
      taxes: { hsnCode: r.hsnCode, gstRate: r.gstPercentage || 0, taxable, cgst: 0, sgst: 0, igst: 0 },
      allocations: [],
    });
  }
  // totalTax is 0 for storefront orders: nothing is added to what the customer pays.
  return { lines, totalUnits, totalAmount, totalTax: 0 };
}

/**
 * Place order(s) from a cart.
 * @param {string} consumerId
 * @param {object} body { items:[{listingId, qty}], shippingAddressId?, shippingAddress?, paymentMode }
 * @returns {Promise<Array>} the created orders
 */
async function checkout(consumerId, { items = [], shippingAddressId, shippingAddress } = {}) {
  if (!Array.isArray(items) || !items.length) throw httpErr("Your cart is empty");

  const consumer = await Consumer.findById(consumerId);
  if (!consumer) throw httpErr("Account not found", 404);

  // Resolve the shipping address: an existing saved address id, an inline
  // address, or the consumer's default.
  let shipAddr = null;
  if (shippingAddressId) {
    shipAddr = consumer.addresses.id(shippingAddressId);
    if (!shipAddr) throw httpErr("Selected address not found", 404);
    shipAddr = shipAddr.toObject();
  } else if (shippingAddress && (shippingAddress.line1 || shippingAddress.pincode)) {
    shipAddr = shippingAddress;
  } else {
    const def = consumer.addresses.find((a) => a.isDefault) || consumer.addresses[0];
    shipAddr = def ? def.toObject() : null;
  }
  if (!shipAddr || !shipAddr.line1 || !shipAddr.pincode) {
    throw httpErr("A shipping address (with pincode) is required");
  }

  // Trust the server for prices/sellers — never the client.
  const resolved = await catalog.resolveForCheckout(items.map((i) => i.listingId));
  if (!resolved.size) throw httpErr("None of the products in your cart are available", 409);

  // Group cart items by seller.
  const bySeller = new Map();
  for (const ci of items) {
    const r = resolved.get(String(ci.listingId));
    if (!r) throw httpErr("A product in your cart is no longer available", 409);
    if (!bySeller.has(r.sellerId)) bySeller.set(r.sellerId, []);
    bySeller.get(r.sellerId).push(ci);
  }

  const orderShipAddress = {
    label: shipAddr.label,
    name: shipAddr.fullName || consumer.name,
    phone: shipAddr.phone || consumer.phone,
    line1: shipAddr.line1,
    line2: shipAddr.line2,
    city: shipAddr.city,
    district: shipAddr.district,
    state: shipAddr.state,
    stateCode: shipAddr.stateCode,
    pincode: shipAddr.pincode,
  };

  const created = [];
  for (const [sellerId, cartItems] of bySeller) {
    const customer = await upsertSellerCustomer(sellerId, consumer, shipAddr);
    const { lines, totalUnits, totalAmount, totalTax } = buildLines(cartItems, resolved);
    const orderNumber = await nextWebOrderNumber(sellerId);

    const order = await Order.create({
      ownerType: "seller",
      ownerId: new mongoose.Types.ObjectId(sellerId),
      orderNumber,
      consumerId: consumer._id,
      customerId: customer._id,
      customerName: customer.name,
      shippingAddress: orderShipAddress,
      billingAddress: orderShipAddress,
      items: lines,
      totalUnits,
      totalAmount: tax.round2(totalAmount),
      totalTax: tax.round2(totalTax),
      channel: "online",
      salesChannel: "website",
      payment: { mode: "cod", status: "pending" },
      status: "pending",
    });
    created.push(order);
  }

  return created;
}

/** A shopper's own orders, most recent first. */
async function listOrders(consumerId) {
  return Order.find({ consumerId }).sort({ placedAt: -1 }).limit(200).lean();
}

/** One of the shopper's orders (ownership enforced by consumerId). */
async function getOrder(consumerId, orderId) {
  if (!mongoose.isValidObjectId(orderId)) throw httpErr("Order not found", 404);
  const order = await Order.findOne({ _id: orderId, consumerId }).lean();
  if (!order) throw httpErr("Order not found", 404);
  return order;
}

/* ── Consumer saved addresses ── */

async function listAddresses(consumerId) {
  const c = await Consumer.findById(consumerId).select("addresses");
  if (!c) throw httpErr("Account not found", 404);
  return c.addresses;
}

async function addAddress(consumerId, addr) {
  const c = await Consumer.findById(consumerId);
  if (!c) throw httpErr("Account not found", 404);
  if (!addr || !addr.line1 || !addr.pincode) throw httpErr("Address line and pincode are required");
  // First address (or an explicit default) becomes the default.
  const makeDefault = addr.isDefault || c.addresses.length === 0;
  if (makeDefault) c.addresses.forEach((a) => (a.isDefault = false));
  c.addresses.push({ ...addr, isDefault: makeDefault });
  await c.save();
  return c.addresses;
}

async function deleteAddress(consumerId, addressId) {
  const c = await Consumer.findById(consumerId);
  if (!c) throw httpErr("Account not found", 404);
  const addr = c.addresses.id(addressId);
  if (!addr) throw httpErr("Address not found", 404);
  const wasDefault = addr.isDefault;
  addr.deleteOne();
  if (wasDefault && c.addresses.length) c.addresses[0].isDefault = true;
  await c.save();
  return c.addresses;
}

module.exports = {
  checkout,
  listOrders,
  getOrder,
  listAddresses,
  addAddress,
  deleteAddress,
};
