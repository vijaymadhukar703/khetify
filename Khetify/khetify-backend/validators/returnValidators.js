const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const returnLine = z.object({
  productId: objectId,
  name: z.string().trim().optional(),
  qty: z.coerce.number().int().positive(),
  serials: z.array(z.string().trim()).optional(),
  lotNumber: z.string().trim().optional(),
  batchNumber: z.string().trim().optional(),
  reason: z.string().trim().max(300).optional(),
  condition: z.enum(["resellable", "damaged", "expired"]).optional(),
});

const createBody = z.object({
  orderId: objectId.nullable().optional(),
  customerId: objectId.nullable().optional(),
  warehouseId: objectId,
  lines: z.array(returnLine).min(1),
  notes: z.string().trim().max(1000).optional(),
});

module.exports = { createBody };
