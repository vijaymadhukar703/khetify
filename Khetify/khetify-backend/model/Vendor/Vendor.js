const mongoose = require("mongoose");

/** A raw-material / packaging supplier the company purchases from. */
const vendorSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true },
    contactPerson: { type: String },
    phone: { type: String },
    email: { type: String },
    gstin: { type: String },
    address: { type: String },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

vendorSchema.index({ companyId: 1, name: 1 });

module.exports = mongoose.model("Vendor", vendorSchema);
