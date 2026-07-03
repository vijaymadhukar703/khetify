const mongoose = require("mongoose");

/**
 * Atomic, gapless-per-key sequence generator. One document per (companyId, key)
 * — e.g. key "grn-202606" or "lot-FERT-NPK-01-260605". Use services/counter.js
 * nextSeq() to increment; never read+write from app code (that races).
 */
const counterSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, required: true },
  key: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

counterSchema.index({ companyId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("Counter", counterSchema);
