const pino = require("pino");

/**
 * Structured logger. Uses pino-pretty in development IF it's installed
 * (devDependency); otherwise falls back to plain JSON so the app never crashes
 * over a missing pretty-printer. Production always emits JSON.
 */
let options = { level: process.env.LOG_LEVEL || "info" };

if (process.env.NODE_ENV !== "production") {
  try {
    require.resolve("pino-pretty");
    options.transport = { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } };
  } catch {
    /* pino-pretty not installed — plain JSON logs are fine */
  }
}

module.exports = pino(options);
