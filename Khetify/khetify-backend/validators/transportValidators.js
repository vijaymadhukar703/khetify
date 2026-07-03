const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const createVehicleBody = z.object({
  regNo: z.string().trim().min(1),
  type: z.string().trim().optional(),
  capacityKg: z.coerce.number().nonnegative().optional(),
  insuranceExpiry: z.coerce.date().optional(),
  fitnessExpiry: z.coerce.date().optional(),
  status: z.enum(["available", "on_trip", "maintenance", "inactive"]).optional(),
});

const createDriverBody = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(5).max(20),
  pin: z.string().trim().min(4).max(8),
  email: z.string().trim().email().optional(),
  licenseNo: z.string().trim().optional(),
  licenseExpiry: z.coerce.date().optional(),
  vehicleId: objectId.optional(),
});

const createShipmentBody = z.object({
  refType: z.enum(["Order", "SupplyOrder", "Transfer", "Manual"]).optional(),
  refId: objectId.nullable().optional(),
  fromWarehouseId: objectId.nullable().optional(),
  toType: z.enum(["customer", "warehouse", "vendor"]).optional(),
  toWarehouseId: objectId.nullable().optional(),
  customerId: objectId.nullable().optional(),
  toLabel: z.string().trim().min(1),
  lines: z.array(z.object({ inventoryId: objectId.optional(), packageId: objectId.optional(), orderId: objectId.optional(), qty: z.coerce.number().positive() })).optional(),
  vehicleId: objectId.optional(),
  driverId: objectId.optional(),
  vehicleNo: z.string().trim().optional(),
  driverName: z.string().trim().optional(),
  driverPhone: z.string().trim().optional(),
  transporter: z.string().trim().optional(),
  ewayBillNo: z.string().trim().optional(),
  lrNumber: z.string().trim().optional(),
  freightCost: z.coerce.number().nonnegative().optional(),
});

const geo = { lat: z.coerce.number().optional(), lng: z.coerce.number().optional() };
const dispatchBody = z.object({ ...geo });
const arrivedBody = z.object({ ...geo });
const verifyBody = z.object({
  qr: z.string().trim().min(1),
  // Transfer receipt POD: the warehouse the verifier is operating at (must be
  // the destination). Receiving needs only the manifest QR + this validation.
  warehouseId: objectId.optional(),
  ...geo,
  lines: z.array(z.object({ lineIndex: z.coerce.number().int().nonnegative(), receivedQty: z.coerce.number().nonnegative() })).optional(),
});
const deliverBody = z.object({
  signedBy: z.string().trim().optional(),
  photoUrls: z.array(z.string().trim()).optional(),
  ...geo,
});
const driverLoginBody = z.object({ phone: z.string().trim().min(5), pin: z.string().trim().min(4) });
const exceptionBody = z.object({ note: z.string().trim().optional(), ...geo });

module.exports = { createVehicleBody, createDriverBody, createShipmentBody, dispatchBody, arrivedBody, verifyBody, deliverBody, driverLoginBody, exceptionBody };
