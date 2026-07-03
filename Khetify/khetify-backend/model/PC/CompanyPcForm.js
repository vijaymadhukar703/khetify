const mongoose = require("mongoose");

/**
 * A company-configurable PC APPLICATION FORM. One per company. The ordered
 * `fields` define what a seller must provide to apply for that company's
 * Principal Certificate. `profileField` (dot-path into the seller PROFILE
 * autofill map — see pcService.sellerAutofill) marks a field as auto-filled
 * from the seller's profile (so a seller never re-types PAN/GSTIN/etc.).
 *
 * Companies that haven't customised a form fall back to DEFAULT_PC_FORM_FIELDS
 * (not persisted until they save) — fully editable at any time.
 */
const FIELD_TYPES = ["text", "number", "date", "select", "file"];

const pcFormFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: FIELD_TYPES, default: "text" },
    required: { type: Boolean, default: false },
    options: { type: [String], default: undefined }, // for type "select"
    profileField: { type: String, default: null }, // autofill source (dot-path)
  },
  { _id: false }
);

const companyPcFormSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    fields: { type: [pcFormFieldSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

/** Sensible default form for companies that haven't customised one. Profile-
 * mapped fields autofill from the seller's profile; the rest are company-specific. */
const DEFAULT_PC_FORM_FIELDS = [
  { key: "businessName", label: "Business / legal name", type: "text", required: true, profileField: "identity.businessName" },
  { key: "contactPerson", label: "Contact person", type: "text", required: true, profileField: "identity.contactPerson" },
  { key: "email", label: "Email", type: "text", required: true, profileField: "identity.email" },
  { key: "phone", label: "Phone", type: "text", required: true, profileField: "identity.phone" },
  { key: "address", label: "Address", type: "text", required: true, profileField: "identity.address" },
  { key: "gstin", label: "GSTIN", type: "text", required: true, profileField: "compliance.gstin" },
  { key: "pan", label: "PAN", type: "text", required: true, profileField: "compliance.pan" },
  { key: "productCategories", label: "Product categories you want to sell", type: "text", required: true, profileField: null },
  { key: "gstCertificate", label: "GST certificate", type: "file", required: true, profileField: "compliance.gstCertificateUrl" },
  { key: "panFile", label: "PAN card", type: "file", required: true, profileField: "compliance.panFileUrl" },
];

companyPcFormSchema.statics.FIELD_TYPES = FIELD_TYPES;
companyPcFormSchema.statics.DEFAULT_PC_FORM_FIELDS = DEFAULT_PC_FORM_FIELDS;

const CompanyPcForm = mongoose.model("CompanyPcForm", companyPcFormSchema);
CompanyPcForm.FIELD_TYPES = FIELD_TYPES;
CompanyPcForm.DEFAULT_PC_FORM_FIELDS = DEFAULT_PC_FORM_FIELDS;

module.exports = CompanyPcForm;
