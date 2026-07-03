const logger = require("../services/logger");

/** 404 for unmatched API routes. */
function notFound(req, res) {
  res.status(404).json({ success: false, message: "Not found" });
}

/**
 * Central error handler (must be mounted LAST). Honours err.status, logs 5xx
 * with the request id, and never leaks stack traces to clients.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) logger.error({ err, reqId: req.id, path: req.originalUrl }, "Unhandled error");
  res.status(status).json({ success: false, message: status >= 500 ? "Server error" : err.message, reqId: req.id });
}

module.exports = { notFound, errorHandler };
