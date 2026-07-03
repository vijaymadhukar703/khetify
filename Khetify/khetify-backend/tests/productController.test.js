const mongoose = require("mongoose");
const Product = require("../model/Company/productModel");
const { getAllProducts } = require("../controller/Company/productController");

// Minimal res double capturing status + json.
function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

let companyA, companyB;

beforeEach(async () => {
  companyA = new mongoose.Types.ObjectId();
  companyB = new mongoose.Types.ObjectId();
  await Product.create([
    { companyId: companyA, productName: "A-Urea", skuNumber: "A-1", productStatus: "active" },
    { companyId: companyA, productName: "A-Neem", skuNumber: "A-2", productStatus: "active" },
    { companyId: companyB, productName: "B-Seeds", skuNumber: "B-1", productStatus: "active" },
  ]);
});

describe("GET /product/all → getAllProducts (company-scoped)", () => {
  test("returns ONLY the authenticated company's products", async () => {
    const res = mockRes();
    await getAllProducts({ user: { companyId: companyA }, query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    const skus = res.body.data.map((p) => p.skuNumber).sort();
    expect(skus).toEqual(["A-1", "A-2"]);
    // a different company's product must NEVER leak through
    expect(skus).not.toContain("B-1");
  });

  test("ignores a client-supplied companyId (no multi-tenancy leak)", async () => {
    const res = mockRes();
    // caller is company A but tries to spoof company B via the query param
    await getAllProducts({ user: { companyId: companyA }, query: { companyId: String(companyB) } }, res);

    // still company A's two products only — the spoofed companyId is ignored
    expect(res.body.count).toBe(2);
    const skus = res.body.data.map((p) => p.skuNumber).sort();
    expect(skus).toEqual(["A-1", "A-2"]);
    expect(skus).not.toContain("B-1");
  });

  test("still honours the search filter within the company scope", async () => {
    const res = mockRes();
    await getAllProducts({ user: { companyId: companyA }, query: { search: "urea" } }, res);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].skuNumber).toBe("A-1");
  });
});
