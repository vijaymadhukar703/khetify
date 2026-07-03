const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const createBody = z.object({
  warehouseId: objectId,
  parentId: objectId.nullable().optional(),
  type: z.enum(["zone", "aisle", "rack", "shelf", "bin"]),
  code: z.string().trim().min(1).max(20),
  capacityUnits: z.coerce.number().int().nonnegative().optional(),
  allowedCategories: z.array(z.string().trim()).optional(),
  isPickFace: z.boolean().optional(),
});

const generateBody = z.object({
  warehouseId: objectId,
  zones: z.coerce.number().int().positive(),
  racksPerZone: z.coerce.number().int().positive(),
  shelvesPerRack: z.coerce.number().int().positive(),
  binsPerShelf: z.coerce.number().int().positive(),
  binCapacity: z.coerce.number().int().nonnegative().optional(),
});

const moveBody = z
  .object({
    inventoryId: objectId,
    fromLocationId: objectId.nullable().optional(),
    toLocationId: objectId.nullable().optional(),
    qty: z.coerce.number().int().positive(),
  })
  .refine((b) => b.fromLocationId || b.toLocationId, {
    message: "at least one of fromLocationId / toLocationId is required",
  });

const listQuery = z.object({
  warehouseId: objectId.optional(),
  type: z.enum(["zone", "aisle", "rack", "shelf", "bin"]).optional(),
});

module.exports = { createBody, generateBody, moveBody, listQuery };
