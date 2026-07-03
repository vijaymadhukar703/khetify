/**
 * Migrate legacy user roles to the Sprint-0 role set. The old "inventory_staff"
 * role is mapped to "warehouse_operator". Idempotent.
 *
 *   node scripts/migrations/002-user-roles.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../../model/User/User");

const MAP = { inventory_staff: "warehouse_operator" };

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  let total = 0;
  for (const [from, to] of Object.entries(MAP)) {
    const r = await User.updateMany({ role: from }, { $set: { role: to } });
    total += r.modifiedCount || 0;
    console.log(`  • ${from} → ${to}: ${r.modifiedCount || 0}`);
  }
  console.log(`✅ Migrated ${total} user role(s)`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
