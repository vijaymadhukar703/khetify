const express = require("express");

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const loadSubscription = require("../../middlewares/loadSubscription");
const requireFeature = require("../../middlewares/requireFeature");
const { FEATURES } = require("../../config/plans");
const { apiKeyAuth, requireScope } = require("../../middlewares/apiKeyAuth");
const v = require("../../validators/integrationValidators");
const ctrl = require("../../controller/Integration/integrationController");

/* Management plane: JWT (company_admin) + API_ACCESS plan feature. */
const mgmt = express.Router();
const gate = [auth, authorize("api:manage", "company_admin"), loadSubscription, requireFeature(FEATURES.API_ACCESS)];

mgmt.get("/keys", ...gate, ctrl.listKeys);
mgmt.post("/keys", ...gate, validate({ body: v.createKeyBody }), ctrl.createKey);
mgmt.delete("/keys/:id", ...gate, ctrl.revokeKey);

mgmt.get("/webhooks", ...gate, ctrl.listWebhooks);
mgmt.post("/webhooks", ...gate, validate({ body: v.createWebhookBody }), ctrl.createWebhook);
mgmt.patch("/webhooks/:id", ...gate, validate({ body: v.updateWebhookBody }), ctrl.updateWebhook);
mgmt.delete("/webhooks/:id", ...gate, ctrl.deleteWebhook);
mgmt.post("/webhooks/:id/test", ...gate, ctrl.testWebhook);

mgmt.get("/channels", ...gate, ctrl.listChannels);
mgmt.post("/channels", ...gate, validate({ body: v.connectChannelBody }), ctrl.connectChannel);

/* Data plane: API-key auth (machine-to-machine). */
const pos = express.Router();
pos.post("/sales", apiKeyAuth, requireScope("pos:sync"), validate({ body: v.posSyncBody }), ctrl.posSync);

module.exports = { mgmt, pos };
