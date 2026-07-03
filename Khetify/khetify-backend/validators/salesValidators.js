const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const address = z.object({
  label: z.string().trim().optional(),
  line1: z.string().trim().optional(),
  city: z.string().trim().optional(),
  district: z.string().trim().optional(),
  state: z.string().trim().optional(),
  stateCode: z.string().trim().regex(/^[0-9]{2}$/, "2-digit state code").optional(),
  pincode: z.string().trim().optional(),
  isDefault: z.boolean().optional(),
});

const createCustomerBody = z.object({
  name: z.string().trim().min(1),
  type: z.enum(["retail", "business"]).optional(),
  phone: z.string().trim().min(5).max(20).optional(),
  email: z.string().trim().email().optional(),
  gstin: z.string().trim().regex(GSTIN, "invalid GSTIN format").optional(),
  addresses: z.array(address).optional(),
  creditLimit: z.coerce.number().nonnegative().optional(),
  tags: z.array(z.string().trim()).optional(),
});

const updateCustomerBody = createCustomerBody.partial().extend({ isActive: z.boolean().optional() });

const createOrderBody = z.object({
  customerId: objectId.optional(),
  items: z.array(z.object({
    productId: objectId,
    qty: z.coerce.number().int().positive(),
    price: z.coerce.number().nonnegative().optional(),
  })).min(1),
  salesChannel: z.enum(["pos", "website", "shopify", "amazon", "flipkart", "manual", "b2b"]).optional(),
  channel: z.enum(["online", "offline"]).optional(),
  payment: z.object({
    mode: z.string().trim().optional(),
    status: z.enum(["pending", "paid", "partial", "refunded"]).optional(),
    txnRef: z.string().trim().optional(),
  }).optional(),
  shippingAddress: address.optional(),
  billingAddress: address.optional(),
  orderNumber: z.string().trim().optional(),
});

module.exports = { createCustomerBody, updateCustomerBody, createOrderBody };
