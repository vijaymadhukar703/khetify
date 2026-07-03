const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const generateBody = z.object({
  inventoryId: objectId,
  qty: z.coerce.number().int().positive().max(10000),
});

const printBody = z.object({
  serials: z.array(z.string().trim().min(1)).min(1),
});

const transitionBody = z.object({
  serials: z.array(z.string().trim().min(1)).min(1),
  toStatus: z.enum(["printed", "in_stock", "picked", "packed", "shipped", "sold", "returned", "damaged"]),
  locationId: objectId.nullable().optional(),
  refType: z.string().trim().optional(),
  refId: objectId.optional(),
});

const scanBody = z.object({
  code: z.string().trim().min(1),
});

const recallBody = z.object({
  lotNumber: z.string().trim().min(1),
});

module.exports = { generateBody, printBody, transitionBody, scanBody, recallBody };
