const apiKeyService = require("../../services/apiKeyService");
const channelService = require("../../services/channelService");
const outbox = require("../../services/outboxService");
const posService = require("../../services/posService");
const audit = require("../../services/auditService");

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error("Integration error:", err);
  res.status(status).json({ success: false, message: err.message || "Server error" });
};

/* ---- API keys ---- */
exports.listKeys = async (req, res) => { try { res.json({ success: true, data: await apiKeyService.listKeys(req.user.companyId) }); } catch (e) { fail(res, e); } };
exports.createKey = async (req, res) => {
  try {
    const r = await apiKeyService.createKey(req.user.companyId, req.body);
    await audit.log({ req, action: "apikey.created", entityType: "ApiKey", entityId: r.id, after: { name: req.body.name, scopes: r.scopes } });
    res.status(201).json({ success: true, message: "Store this key now — it won't be shown again", data: r });
  } catch (e) { fail(res, e); }
};
exports.revokeKey = async (req, res) => { try { await apiKeyService.revokeKey(req.user.companyId, req.params.id); res.json({ success: true, message: "Key revoked" }); } catch (e) { fail(res, e); } };

/* ---- webhooks ---- */
exports.listWebhooks = async (req, res) => { try { res.json({ success: true, data: await channelService.listWebhooks(req.user.companyId) }); } catch (e) { fail(res, e); } };
exports.createWebhook = async (req, res) => { try { res.status(201).json({ success: true, data: await channelService.createWebhook(req.user.companyId, req.body) }); } catch (e) { fail(res, e); } };
exports.updateWebhook = async (req, res) => { try { res.json({ success: true, data: await channelService.updateWebhook(req.user.companyId, req.params.id, req.body) }); } catch (e) { fail(res, e); } };
exports.deleteWebhook = async (req, res) => { try { await channelService.deleteWebhook(req.user.companyId, req.params.id); res.json({ success: true, message: "Deleted" }); } catch (e) { fail(res, e); } };
exports.testWebhook = async (req, res) => {
  try { await outbox.testPing(req.user.companyId, req.params.id); res.json({ success: true, message: "Test ping sent" }); }
  catch (e) { fail(res, e); }
};

/* ---- channels ---- */
exports.listChannels = async (req, res) => { try { res.json({ success: true, data: await channelService.listChannels(req.user.companyId) }); } catch (e) { fail(res, e); } };
exports.connectChannel = async (req, res) => { try { res.json({ success: true, data: await channelService.connectChannel(req.user.companyId, req.body) }); } catch (e) { fail(res, e); } };

/* ---- POS sync (API-key auth) ---- */
exports.posSync = async (req, res) => {
  try {
    const results = await posService.syncSales(req.user.companyId, req.body.sales);
    const ok = results.filter((r) => r.ok).length;
    res.json({ success: true, message: `${ok}/${results.length} processed`, data: results });
  } catch (e) { fail(res, e); }
};
