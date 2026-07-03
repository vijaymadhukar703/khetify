/**
 * Backfill Order.customerId from the legacy customerName string.
 * For each company, distinct customerNames without a customerId get a Customer
 * created (by name) and linked. Idempotent: re-running skips already-linked.
 *
 *   node scripts/migrations/001-backfill-customer.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../../model/Order/Order");
const Customer = require("../../model/Sales/Customer");
const { nextSeq } = require("../../services/counterService");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const orders = await Order.find({ customerId: null, customerName: { $ne: null, $nin: ["", null] } }).select("companyId customerName");
  let linked = 0;
  const cache = new Map(); // companyId|name -> customerId
  for (const o of orders) {
    const key = `${o.companyId}|${o.customerName.toLowerCase()}`;
    let customerId = cache.get(key);
    if (!customerId) {
      let cust = await Customer.findOne({ companyId: o.companyId, name: o.customerName });
      if (!cust) {
        const seq = await nextSeq(o.companyId, "cust");
        cust = await Customer.create({ companyId: o.companyId, ownerType: "company", ownerId: o.companyId, name: o.customerName, customerCode: `CUST-${String(seq).padStart(4, "0")}`, type: "retail" });
      }
      customerId = cust._id;
      cache.set(key, customerId);
    }
    await Order.updateOne({ _id: o._id }, { customerId });
    linked += 1;
  }
  console.log(`✅ Linked ${linked} order(s) to ${cache.size} customer(s)`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
