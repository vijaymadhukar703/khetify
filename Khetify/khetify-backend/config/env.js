/**
 * Centralised, fail-fast environment config. Required vars are validated at
 * boot so the process exits immediately with a clear message instead of
 * failing later at runtime. Import this once from Server.js (after dotenv).
 */
require("dotenv").config();

const REQUIRED = ["MONGO_URI", "JWT_SECRET"];

function load() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(`❌ Missing required env var(s): ${missing.join(", ")}. See .env.example.`);
    process.exit(1);
  }

  // Warn (don't fail) on recommended-but-optional secrets.
  if (!process.env.MASTER_KEY) {
    // eslint-disable-next-line no-console
    console.warn("⚠️  MASTER_KEY not set — channel credentials use a dev default. Set it in production.");
  }

  return {
    port: Number(process.env.PORT) || 5000,
    mongoUri: process.env.MONGO_URI,
    jwtSecret: process.env.JWT_SECRET,
    corsOrigins: (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean),
    nodeEnv: process.env.NODE_ENV || "development",
    storageDriver: process.env.STORAGE_DRIVER || "local",
    logLevel: process.env.LOG_LEVEL || "info",
  };
}

module.exports = { load, REQUIRED };
