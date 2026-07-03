const mongoose = require("mongoose");

/**
 * Extra driver attributes attached to a User with role "driver". The User holds
 * identity + auth (phone + bcrypt PIN, from Sprint 0); this holds licence and
 * the currently-assigned vehicle.
 */
const driverProfileSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    licenseNo: { type: String },
    licenseExpiry: { type: Date },
    phone: { type: String },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null },
  },
  { timestamps: true }
);

driverProfileSchema.index({ companyId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("DriverProfile", driverProfileSchema);
