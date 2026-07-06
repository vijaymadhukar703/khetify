/**
 * checkCompany.js — one-off lookup to diagnose a failing login.
 * Prints whether a company exists for a given email/number, and its status.
 *
 *   node scripts/checkCompany.js beejbhandar@gmail.com
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Company = require("../model/Company/Company");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in your .env");
  const arg = (process.argv[2] || "").trim();

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const total = await Company.countDocuments();
    console.log(`\n📊 Total companies in DB: ${total}\n`);

    if (arg) {
      const q = arg.includes("@")
        ? { email: arg.toLowerCase() }
        : { number: arg };
      const c = await Company.findOne(q).select("email number fullName status password").lean();
      if (!c) {
        console.log(`❌ No company matches ${JSON.stringify(q)} — that's why login is "Invalid credentials".`);
      } else {
        console.log("✅ Found matching company:");
        console.log({
          email: c.email,
          number: c.number,
          fullName: c.fullName,
          status: c.status,
          hasPasswordHash: !!c.password,
        });
      }
    }

    console.log("\n— All company logins (email / number / status) —");
    const all = await Company.find().select("email number status").lean();
    all.forEach((c) => console.log(`  • ${c.email || "(no email)"}  |  ${c.number || "(no number)"}  |  ${c.status}`));
    console.log("");
  } finally {
    await mongoose.connection.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("❌", e.message); process.exit(1); });
