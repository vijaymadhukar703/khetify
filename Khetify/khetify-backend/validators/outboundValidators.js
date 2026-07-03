const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const generateWaveBody = z.object({
  warehouseId: objectId.optional(),
  orderIds: z.array(objectId).min(1),
});

const pickLineBody = z.object({
  lineIndex: z.coerce.number().int().nonnegative(),
  binCode: z.string().trim().optional(),
  serials: z.array(z.string().trim()).optional(),
  qty: z.coerce.number().int().positive().optional(),
});

const createPackageBody = z.object({
  orderId: objectId,
  items: z.array(z.object({
    productId: objectId,
    qty: z.coerce.number().int().positive(),
    serials: z.array(z.string().trim()).optional(),
  })).min(1),
  weightKg: z.coerce.number().nonnegative().optional(),
  dims: z.string().trim().optional(),
});

const dispatchBody = z.object({
  orderId: objectId,
  vehicleNo: z.string().trim().optional(),
  driverName: z.string().trim().optional(),
  driverPhone: z.string().trim().optional(),
  transporter: z.string().trim().optional(),
  toLabel: z.string().trim().optional(),
  fromWarehouseId: objectId.optional(),
});

module.exports = { generateWaveBody, pickLineBody, createPackageBody, dispatchBody };
