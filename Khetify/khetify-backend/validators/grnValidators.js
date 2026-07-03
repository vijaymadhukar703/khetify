const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const createLine = z.object({
  productId: objectId.nullable().optional(),
  name: z.string().trim().optional(),
  expectedQty: z.coerce.number().nonnegative().optional(),
  unitCost: z.coerce.number().nonnegative().optional(),
  mrp: z.coerce.number().nonnegative().optional(),
  lotNumber: z.string().trim().optional(),
  batchNumber: z.string().trim().optional(),
});

const createBody = z.object({
  refType: z.enum(["PurchaseOrder", "SupplyOrder", "Return", "Manual"]).optional(),
  refId: objectId.nullable().optional(),
  warehouseId: objectId,
  supplierId: objectId.nullable().optional(),
  lines: z.array(createLine).optional(),
  vehicleNo: z.string().trim().optional(),
  lrNumber: z.string().trim().optional(),
  invoiceNo: z.string().trim().optional(),
  notes: z.string().trim().max(1000).optional(),
});

const receiveLine = z.object({
  productId: objectId.nullable().optional(),
  receivedQty: z.coerce.number().nonnegative().optional(),
  acceptedQty: z.coerce.number().nonnegative().optional(),
  rejectedQty: z.coerce.number().nonnegative().optional(),
  rejectReason: z.string().trim().optional(),
  lotNumber: z.string().trim().optional(),
  batchNumber: z.string().trim().optional(),
  mfgDate: z.coerce.date().nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  mrp: z.coerce.number().nonnegative().optional(),
  unitCost: z.coerce.number().nonnegative().optional(),
});

const receiveBody = z.object({
  lines: z.array(receiveLine).optional(),
  vehicleNo: z.string().trim().optional(),
  lrNumber: z.string().trim().optional(),
  invoiceNo: z.string().trim().optional(),
});

const writeoffBody = z.object({
  inventoryId: objectId,
  qty: z.coerce.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});

const completePutawayBody = z.object({
  locationId: objectId.optional(),
});

module.exports = { createBody, receiveBody, writeoffBody, completePutawayBody };
