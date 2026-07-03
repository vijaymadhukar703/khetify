/**
 * Build/sync all Mongoose indexes. Run after deploy or schema changes:
 *   node scripts/ensureIndexes.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

// Require every model file so its schema (and indexes) is registered.
function loadModels(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) loadModels(full);
    else if (entry.name.endsWith(".js")) require(full);
  }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected");
  loadModels(path.join(__dirname, "../model"));

  const names = mongoose.modelNames();
  for (const name of names) {
    await mongoose.model(name).syncIndexes();
    console.log(`  • ${name} indexes synced`);
  }
  console.log(`🎉 Synced indexes for ${names.length} model(s)`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error("❌ ensureIndexes failed:", err.message);
  process.exit(1);
});
