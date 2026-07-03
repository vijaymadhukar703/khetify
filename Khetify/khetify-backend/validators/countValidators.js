const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

/* ---- adjustments ---- */
const createAdjustmentBody = z.object({
  inventoryId: objectId,
  locationId: objectId.nullable().optional(),
  qtyDelta: z.coerce.number().int().refine((n) => n !== 0, "qtyDelta cannot be zero"),
  reason: z.enum(["count_variance", "damage", "theft", "expiry", "data_entry", "other"]),
  note: z.string().trim().max(500).optional(),
});

/* ---- cycle counts ---- */
const generateCountBody = z.object({
  warehouseId: objectId,
  type: z.enum(["cycle", "full_audit"]).optional(),
  freeze: z.boolean().optional(),
  scope: z
    .object({
      zoneId: objectId.nullable().optional(),
      category: z.string().trim().nullable().optional(),
      abcClass: z.enum(["A", "B", "C"]).nullable().optional(),
    })
    .optional(),
});

const submitCountBody = z.object({
  lines: z
    .array(
      z.object({
        index: z.coerce.number().int().nonnegative(),
        countedQty: z.coerce.number().int().nonnegative(),
        recount: z.boolean().optional(),
      })
    )
    .min(1),
});

module.exports = { createAdjustmentBody, generateCountBody, submitCountBody };
