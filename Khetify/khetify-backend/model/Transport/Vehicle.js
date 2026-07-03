const mongoose = require("mongoose");

/** A delivery vehicle in the company's fleet (or a hired one). */
const vehicleSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    regNo: { type: String, required: true }, // unique per company
    type: { type: String }, // truck / tempo / bike / 3PL
    capacityKg: { type: Number },
    insuranceExpiry: { type: Date },
    fitnessExpiry: { type: Date },
    status: { type: String, enum: ["available", "on_trip", "maintenance", "inactive"], default: "available" },
  },
  { timestamps: true }
);

vehicleSchema.index({ companyId: 1, regNo: 1 }, { unique: true });

module.exports = mongoose.model("Vehicle", vehicleSchema);
