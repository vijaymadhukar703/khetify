const mongoose = require("mongoose");

// ================= VARIANT SCHEMA =================

const variantSchema = new mongoose.Schema({
  color: {
    type: String,
  },

  size: {
    type: String,
  },

  length: {
    type: Number,
  },

  width: {
    type: Number,
  },

  height: {
    type: Number,
  },

  weight: {
    type: Number,
  },

  price: {
    type: Number,
  },

  stock: {
    type: Number,
    default: 0,
  },
});

// ================= PRODUCT SCHEMA =================

const productSchema = new mongoose.Schema(
  {
    // Company Reference
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    // Basic Product Info
    productName: { type: String },
    brandName:   { type: String },
    category: { type: String },
    unitType: { type: String },
    unit: { type: String },
    description: { type: String },

    // SKU & Codes
    skuNumber: { type: String },
    hsnCode: { type: String },
    batchNumber: { type: String },
    manufactureLicenseNo: { type: String },

    // When true, every physical unit gets its own serialized barcode
    // (UnitSerial). When false, stock is tracked purely by quantity (FEFO).
    trackSerial: { type: Boolean, default: false },

    // Pricing
    costPrice: { type: Number },
    mrp: { type: Number },
    gstPercentage: { type: Number, default: 0 },

    // Stock & Order
    availableStock: { type: Number },
    minimumOrderQuantity: { type: Number },
    monthlyProductionCapacity: { type: Number },

    // Origin & Packaging
    countryOrigin: { type: String },
    packagingType: { type: String },
    dispatchLocation: { type: String },

    // Bulk packaging — how the product ships in bulk and how many base units
    // each bulk package holds. e.g. type "Carton", capacity 50 → 1 carton = 50 units.
    bulkPackaging: {
      type: { type: String },        // Carton | Bag | Box | Sack | Drum | Other | <custom>
      customType: { type: String },  // free text when type === "Other"
      capacity: { type: Number },    // base units per package
      capacityUnit: { type: String, default: "units" },
    },

    // Dates
    manufacturingDate: { type: Date },
    expiryDate: { type: Date },
    shelfLife: { type: String },

    // Quality & Storage
    qualityGrade: { type: String },
    storageInstructions: { type: String },
    safetyInstructions: { type: String },

    // Images
    productImages: [
      {
        type: String,
      },
    ],

    // ================= VARIANT TYPE =================

    variantType: {
      type: String,
      enum: ["single", "multiple"],
      default: "single",
    },

    // ===== SINGLE PRODUCT DETAILS =====

    price: { type: Number },

    length: { type: Number },

    width: { type: Number },

    height: { type: Number },

    weight: { type: Number },

    // ===== MULTIPLE VARIANTS =====

    variants: [variantSchema],

    // ================= STATUS =================

    productStatus: {
      type: String,
      enum: ["active", "inactive"],
      default: "inactive",
    },

    productUpload: {
      type: String,
      enum: ["saveDraft", "uploaded"],
      default: "saveDraft",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Product", productSchema);
