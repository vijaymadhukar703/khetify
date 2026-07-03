const { z } = require("zod");
const { ASSIGNABLE_ROLES } = require("../config/permissions");

// Operational roles are consolidated to company_admin / operations_manager /
// sales_manager. Legacy roles on EXISTING users keep working (User model enum
// still lists them) — they just can't be assigned via the team API anymore.
const assignable = ASSIGNABLE_ROLES;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char ObjectId");

const createUserBody = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(5).max(20).optional(),
  role: z.enum(assignable).optional(),
  password: z.string().min(6).max(100).optional(),
  // Warehouse-level access: the warehouses this user is assigned to.
  warehouseIds: z.array(objectId).max(50).optional(),
});

const updateUserBody = z
  .object({
    name: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    role: z.enum(assignable).optional(),
    status: z.enum(["active", "invited", "disabled"]).optional(),
    warehouseIds: z.array(objectId).max(50).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });

const loginUserBody = z
  .object({
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    password: z.string().min(1),
  })
  .refine((b) => b.email || b.phone, { message: "email or phone is required" });

module.exports = { createUserBody, updateUserBody, loginUserBody };
