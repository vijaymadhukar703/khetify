const mongoose = require("mongoose");

/** Logistics cost breakdown per shipment. totalCost + costPerUnit auto-computed. */
const shipmentCostSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Shipment", required: true, unique: true },
    warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },

    fuelCost: { type: Number, default: 0 },
    driverCost: { type: Number, default: 0 },
    vehicleCost: { type: Number, default: 0 },
    tollCost: { type: Number, default: 0 },
    miscellaneousCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },

    unitsShipped: { type: Number, default: 0 },
    costPerUnit: { type: Number, default: 0 },
    enteredBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

shipmentCostSchema.pre("save", function () {
  this.totalCost = (this.fuelCost || 0) + (this.driverCost || 0) + (this.vehicleCost || 0) + (this.tollCost || 0) + (this.miscellaneousCost || 0);
  this.costPerUnit = this.unitsShipped > 0 ? +(this.totalCost / this.unitsShipped).toFixed(2) : 0;
});

shipmentCostSchema.index({ companyId: 1, createdAt: -1 });
module.exports = mongoose.model("ShipmentCost", shipmentCostSchema);
