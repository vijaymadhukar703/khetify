const mongoose = require("mongoose");

/**
 * Platform administrator — the Khetify super-admin who reviews & approves
 * registered companies (and, later, sellers). Kept as its OWN collection,
 * deliberately separate from Company/User/Seller so the existing tenant auth
 * flows stay completely untouched. An admin JWT carries
 * { id, role:"super_admin", principalType:"admin" }; super_admin holds "*" in
 * config/permissions.js, so authorize() honours it everywhere.
 */
const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["super_admin"], default: "super_admin" },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Admin", adminSchema);
