/**
 * Seed (or update) a platform super-admin.
 *
 *   node scripts/seedAdmin.js <email> <password> ["Full Name"]
 *
 * Or via env: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME.
 * Idempotent: re-running with the same email UPDATES that admin's password/name
 * instead of creating a duplicate.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("../model/Admin/Admin");

async function main() {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.argv[3] || process.env.ADMIN_PASSWORD || "";
  const name = process.argv[4] || process.env.ADMIN_NAME || "Admin";

  if (!email || !password) {
    console.error("Usage: node scripts/seedAdmin.js <email> <password> [\"Full Name\"]");
    console.error("   or set ADMIN_EMAIL / ADMIN_PASSWORD (and optional ADMIN_NAME) in .env");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("Password must be at least 6 characters.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await Admin.findOneAndUpdate(
    { email },
    { $set: { email, passwordHash, name, role: "super_admin", status: "active" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  console.log(`✓ Admin ready: ${admin.email} (${admin.name})`);
  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error("Seed admin failed:", err.message);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
