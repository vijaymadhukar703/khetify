/**
 * Seed a few DEMO companies (mixed statuses) so the admin panel has data to
 * review. Idempotent: matches on email and updates, so re-running won't create
 * duplicates. All docs are marked with demoSeed:true in companyInfo.description
 * is NOT touched — we only set the fields the admin panel reads.
 *
 *   node scripts/seedCompanies.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Company = require("../model/Company/Company");

const DEMO = [
  {
    email: "abc@gmail.com", fullName: "Abc", status: "pending",
    companyName: "Abc", businessType: "Private Limited Company",
    authorizedPerson: "Abc", businessEmail: "mahajangopal85@gmail.com", address: "Abc",
    gstin: "54DG54DF5546", pan: "654ADSF45DSF5", udyam: "UDYAM-MP-00-1234567",
  },
  {
    email: "milton@gmail.com", fullName: "Milton", status: "approved",
    companyName: "Milton", businessType: "Private Limited Company",
    authorizedPerson: "Milton Rao", businessEmail: "milton@gmail.com", address: "Indore, MP",
    gstin: "23ABCDE1234F1Z5", pan: "ABCDE1234F", udyam: "UDYAM-MP-01-7654321",
  },
  {
    email: "kbc@gmail.com", fullName: "Kbc", status: "approved",
    companyName: "Kbc", businessType: "Private Limited Company",
    authorizedPerson: "K B Chandra", businessEmail: "kbc@gmail.com", address: "Bhopal, MP",
    gstin: "23KBCDE9876F1Z2", pan: "KBCDE9876F", udyam: "",
  },
  {
    email: "oppo@gmail.com", fullName: "Oppo", status: "rejected",
    companyName: "Oppo", businessType: "Private Limited Company",
    authorizedPerson: "Oppo Singh", businessEmail: "oppo@gmail.com", address: "Jabalpur, MP",
    gstin: "", pan: "", udyam: "",
  },
  {
    email: "xyz@gmail.com", fullName: "Xyz", status: "approved",
    companyName: "xyz", businessType: "skdhf",
    authorizedPerson: "Xyz Kumar", businessEmail: "xyz@gmail.com", address: "Katni, MP",
    gstin: "23XYZDE1111F1Z9", pan: "XYZDE1111F", udyam: "UDYAM-MP-02-1112223",
  },
  {
    email: "greenfields@gmail.com", fullName: "Ravi Kisan", status: "pending",
    companyName: "Green Fields Agro", businessType: "Partnership Firm",
    authorizedPerson: "Ravi Kisan", businessEmail: "greenfields@gmail.com", address: "Sihora, MP",
    gstin: "23GRNFD2222F1Z7", pan: "GRNFD2222F", udyam: "UDYAM-MP-03-4445556",
  },
  {
    email: "sunrisefoods@gmail.com", fullName: "Sunita Verma", status: "pending",
    companyName: "Sunrise Foods", businessType: "Sole Proprietorship",
    authorizedPerson: "Sunita Verma", businessEmail: "sunrisefoods@gmail.com", address: "Damoh, MP",
    gstin: "23SUNRS3333F1Z1", pan: "SUNRS3333F", udyam: "",
  },
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const password = await bcrypt.hash("123456", 10);

  for (const d of DEMO) {
    await Company.findOneAndUpdate(
      { email: d.email },
      {
        $set: {
          fullName: d.fullName,
          email: d.email,
          subscription: "free",
          status: d.status,
          "companyInfo.companyName": d.companyName,
          "companyInfo.businessType": d.businessType,
          "businessContact.authorizedPerson": d.authorizedPerson,
          "businessContact.businessEmail": d.businessEmail,
          "businessContact.address": d.address,
          "companyDocument.gstinNumber": d.gstin,
          "companyDocument.panNumber": d.pan,
          "companyDocument.udyamIncorporationNumber": d.udyam,
        },
        // Only set a password on INSERT so we don't clobber a real one.
        $setOnInsert: { password },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    console.log(`✓ ${d.companyName} (${d.status})`);
  }

  const counts = await Company.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  console.log("Status counts:", counts.map((c) => `${c._id}:${c.count}`).join("  "));
  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error("Seed companies failed:", err.message);
  try { await mongoose.connection.close(); } catch { /* ignore */ }
  process.exit(1);
});
