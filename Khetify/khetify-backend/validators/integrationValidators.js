const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const createKeyBody = z.object({
  name: z.string().trim().min(1),
  scopes: z.array(z.enum(["pos:sync", "orders:write", "inventory:read"])).optional(),
});

const createWebhookBody = z.object({
  url: z.string().trim().url(),
  events: z.array(z.enum(["inventory.updated", "order.created", "shipment.delivered"])).optional(),
});

const updateWebhookBody = z.object({
  url: z.string().trim().url().optional(),
  events: z.array(z.enum(["inventory.updated", "order.created", "shipment.delivered"])).optional(),
  isActive: z.boolean().optional(),
});

const connectChannelBody = z.object({
  channel: z.enum(["shopify", "woocommerce", "amazon", "flipkart"]),
  credentials: z.record(z.string(), z.any()).optional(),
  locationMapping: z.record(z.string(), z.any()).optional(),
});

const posSyncBody = z.object({
  sales: z.array(z.object({
    externalId: z.string().trim().min(1),
    storeCode: z.string().trim().optional(),
    warehouseId: objectId.optional(),
    soldAt: z.coerce.date().optional(),
    lines: z.array(z.object({
      sku: z.string().trim().optional(),
      barcode: z.string().trim().optional(),
      qty: z.coerce.number().int().positive(),
      price: z.coerce.number().nonnegative().optional(),
      serials: z.array(z.string().trim()).optional(),
    })).min(1),
    customer: z.object({ phone: z.string().trim().optional(), name: z.string().trim().optional() }).optional(),
    payment: z.object({ mode: z.string().trim().optional() }).optional(),
  })).min(1),
});

module.exports = { createKeyBody, createWebhookBody, updateWebhookBody, connectChannelBody, posSyncBody };
