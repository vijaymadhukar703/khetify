const apiKeyService = require("../services/apiKeyService");

/**
 * Authenticates a machine client via the `x-api-key` header. On success attaches
 * req.user = { companyId, id: companyId, role: "api", scopes } so downstream
 * controllers scope by req.user.companyId exactly like JWT requests.
 *
 * Pair with requireScope("pos:sync") on individual routes.
 */
async function apiKeyAuth(req, res, next) {
  try {
    const key = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const record = await apiKeyService.resolveKey(key);
    if (!record) return res.status(401).json({ success: false, message: "Invalid or revoked API key" });
    req.user = { companyId: record.companyId, id: record.companyId, role: "api", scopes: record.scopes };
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: "Auth error" });
  }
}

function requireScope(scope) {
  return (req, res, next) => {
    if (!req.user?.scopes?.includes(scope)) return res.status(403).json({ success: false, message: `Missing scope: ${scope}` });
    next();
  };
}

module.exports = { apiKeyAuth, requireScope };
