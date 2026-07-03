const mongoose = require("mongoose");
const StockMovement = require("../model/Inventory/StockMovement");
const Inventory = require("../model/Inventory/Inventory");
const Product = require("../model/Company/productModel");
const Company = require("../model/Company/Company");

const WINDOW_DAYS = 90;
// Pareto thresholds on cumulative outflow VALUE.
const A_CUTOFF = 0.8; // top 80% of value
const B_CUTOFF = 0.95; // next 15%

/**
 * Rank a company's products by 90-day outflow value (units sold × price) and
 * stamp Inventory.abcClass. A = top 80% of value, B = next 15%, C = the tail
 * (and anything with no movement). Returns per-class counts.
 */
async function classifyABC(companyId) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000);

  const sales = await StockMovement.aggregate([
    {
      $match: {
        ownerId: new mongoose.Types.ObjectId(companyId),
        ownerType: "company",
        type: { $in: ["sale_online", "sale_offline"] },
        createdAt: { $gte: since },
      },
    },
    { $group: { _id: "$productId", outQty: { $sum: { $abs: "$quantity" } } } },
  ]);
  const outByProduct = new Map(sales.map((s) => [String(s._id), s.outQty]));

  // every product of the company (so unmoved ones become C)
  const products = await Product.find({ companyId }, { _id: 1, mrp: 1, costPrice: 1 });
  const scored = products.map((p) => {
    const out = outByProduct.get(String(p._id)) || 0;
    const price = p.mrp || p.costPrice || 0;
    return { productId: p._id, value: out * price };
  });

  const totalValue = scored.reduce((s, r) => s + r.value, 0);
  scored.sort((a, b) => b.value - a.value);

  const buckets = { A: [], B: [], C: [] };
  let cum = 0;
  for (const row of scored) {
    if (row.value <= 0 || totalValue === 0) {
      buckets.C.push(row.productId);
      continue;
    }
    // Class by cumulative share BEFORE this item, so the item that crosses a
    // threshold stays in the lower (more important) class. A lone dominant
    // item (e.g. 90% of value) is therefore still an A.
    const prevShare = cum / totalValue;
    cum += row.value;
    if (prevShare < A_CUTOFF) buckets.A.push(row.productId);
    else if (prevShare < B_CUTOFF) buckets.B.push(row.productId);
    else buckets.C.push(row.productId);
  }

  for (const cls of ["A", "B", "C"]) {
    if (buckets[cls].length) {
      await Inventory.updateMany(
        { ownerId: companyId, ownerType: "company", productId: { $in: buckets[cls] } },
        { $set: { abcClass: cls } }
      );
    }
  }
  return { A: buckets.A.length, B: buckets.B.length, C: buckets.C.length };
}

/** Run classification for every company (used by the nightly job). */
async function classifyAllCompanies() {
  const ids = await Company.find({}, { _id: 1 }).lean();
  let done = 0;
  for (const c of ids) {
    try {
      await classifyABC(c._id);
      done += 1;
    } catch (err) {
      console.error(`ABC classify failed for company ${c._id}:`, err.message);
    }
  }
  return { companies: done };
}

module.exports = { classifyABC, classifyAllCompanies, WINDOW_DAYS };
