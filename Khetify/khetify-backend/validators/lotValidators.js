const { z } = require("zod");

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const sellFefoBody = z.object({
  productId: objectId,
  qty: z.coerce.number().int().positive(),
  channel: z.enum(["online", "offline"]).optional(),
  refId: objectId.optional(),
});

const receiveBody = z.object({
  productId: objectId,
  warehouseId: objectId.nullable().optional(),
  // Lot number is the single identity. Optional here because auto-numbering
  // modes generate it server-side; the service requires one (manual or auto).
  lotNumber: z.string().trim().min(1).optional(),
  // Accepted for backwards compatibility only — the service ignores any client
  // batchNumber and mirrors it from lotNumber (they can never diverge).
  batchNumber: z.string().trim().min(1).optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  mfgDate: z.coerce.date().nullable().optional(),
  qty: z.coerce.number().int().positive(),
  lowStockThreshold: z.coerce.number().int().nonnegative().optional(),
  note: z.string().trim().max(500).optional(),
});

const transferBody = z.object({
  inventoryId: objectId,
  toWarehouseId: objectId,
  qty: z.coerce.number().int().positive(),
});

module.exports = { sellFefoBody, receiveBody, transferBody };
