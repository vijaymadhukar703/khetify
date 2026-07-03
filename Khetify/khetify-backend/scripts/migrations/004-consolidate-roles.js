/**
 * Consolidate operational roles onto the 3-role structure:
 *   company_admin / operations_manager / sales_manager.
 *
 * Legacy warehouse/inventory/transport roles → operations_manager.
 * POS / support roles → sales_manager.
 * company_admin, sales_manager, driver and auditor are untouched.
 * Idempotent — safe to re-run.
 *
 *   node scripts/migrations/004-consolidate-roles.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../../model/User/User");

const MAP = {
  warehouse_manager: "operations_manager",
  warehouse_operator: "operations_manager",
  inventory_manager: "operations_manager",
  transport_manager: "operations_manager",
  pos_operator: "sales_manager",
  support: "sales_manager",
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  let total = 0;
  for (const [from, to] of Object.entries(MAP)) {
    const r = await User.updateMany({ role: from }, { $set: { role: to } });
    total += r.modifiedCount || 0;
    console.log(`  • ${from} → ${to}: ${r.modifiedCount || 0}`);
  }
  console.log(`✅ Consolidated ${total} user role(s)`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
