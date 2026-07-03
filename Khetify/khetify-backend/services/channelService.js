const crypto = require("crypto");
const ChannelConnection = require("../model/Integration/ChannelConnection");
const WebhookEndpoint = require("../model/Integration/WebhookEndpoint");
const { encryptJSON } = require("./cryptoUtil");
const { getConnector } = require("./connectors");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Connect (or update) a sales channel. Credentials are encrypted at rest. */
async function connectChannel(companyId, { channel, credentials, locationMapping }) {
  if (!channel) throw httpErr("channel is required");
  getConnector(channel); // validates channel name
  const set = { isActive: true };
  if (credentials) set.credentials = encryptJSON(credentials);
  if (locationMapping) set.locationMapping = locationMapping;
  const conn = await ChannelConnection.findOneAndUpdate({ companyId, channel }, { $set: set }, { upsert: true, new: true });
  const out = conn.toObject();
  delete out.credentials; // never return secrets
  return out;
}

async function listChannels(companyId) {
  return ChannelConnection.find({ companyId }).select("-credentials").sort({ createdAt: -1 });
}

/* ---- webhook endpoint management ---- */
async function listWebhooks(companyId) {
  return WebhookEndpoint.find({ companyId }).sort({ createdAt: -1 });
}
async function createWebhook(companyId, { url, events = [] }) {
  if (!url) throw httpErr("url is required");
  const secret = `whsec_${crypto.randomBytes(20).toString("hex")}`;
  return WebhookEndpoint.create({ companyId, url, secret, events, isActive: true });
}
async function updateWebhook(companyId, id, patch) {
  const allowed = {};
  for (const k of ["url", "events", "isActive"]) if (patch[k] !== undefined) allowed[k] = patch[k];
  const w = await WebhookEndpoint.findOneAndUpdate({ _id: id, companyId }, allowed, { new: true });
  if (!w) throw httpErr("Webhook not found", 404);
  return w;
}
async function deleteWebhook(companyId, id) {
  const w = await WebhookEndpoint.findOneAndDelete({ _id: id, companyId });
  if (!w) throw httpErr("Webhook not found", 404);
  return w;
}

module.exports = { connectChannel, listChannels, listWebhooks, createWebhook, updateWebhook, deleteWebhook };
