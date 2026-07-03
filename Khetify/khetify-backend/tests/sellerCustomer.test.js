const mongoose = require("mongoose");
const Customer = require("../model/Sales/Customer");
const svc = require("../services/customerService");
const sellerCust = require("../controller/Seller/sellerCustomerController");
const companyCust = require("../controller/Sales/customerController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let companyId, sellerA, sellerB;
beforeEach(() => {
  companyId = new mongoose.Types.ObjectId();
  sellerA = new mongoose.Types.ObjectId();
  sellerB = new mongoose.Types.ObjectId();
});

describe("Customer ownership is additive (company XOR seller)", () => {
  test("rejects a customer with no owner", async () => {
    await expect(Customer.create({ name: "Orphan" })).rejects.toBeTruthy();
  });

  test("accepts a company-owned and a seller-owned customer; 'dealer' type allowed", async () => {
    const co = await Customer.create({ ownerType: "company", ownerId: companyId, companyId, name: "Co Cust", type: "retail" });
    const se = await Customer.create({ ownerType: "seller", ownerId: sellerA, name: "Dealer X", type: "dealer" });
    expect(co.type).toBe("retail");
    expect(se.type).toBe("dealer");
  });
});

describe("customerService is owner-aware", () => {
  test("seller create + list returns only that seller's customers", async () => {
    await svc.createCustomer({ ownerType: "seller", ownerId: sellerA }, { name: "A-Dealer", type: "dealer", phone: "9000000001" });
    await svc.createCustomer({ ownerType: "seller", ownerId: sellerB }, { name: "B-Dealer", type: "dealer", phone: "9000000002" });
    await svc.createCustomer(companyId, { name: "Co Cust", phone: "9000000003" }); // legacy bare-id = company owner

    const aRows = await svc.listCustomers({ ownerType: "seller", ownerId: sellerA });
    expect(aRows).toHaveLength(1);
    expect(aRows[0].name).toBe("A-Dealer");
    expect(aRows[0].ownerType).toBe("seller");

    const coRows = await svc.listCustomers({ ownerType: "company", ownerId: companyId });
    expect(coRows).toHaveLength(1);
    expect(coRows[0].name).toBe("Co Cust");
  });

  test("phone dedup is per-owner: blocks within one seller, allows the same phone across owners", async () => {
    await svc.createCustomer({ ownerType: "seller", ownerId: sellerA }, { name: "First", phone: "9111111111" });
    // same phone, same owner → blocked
    await expect(svc.createCustomer({ ownerType: "seller", ownerId: sellerA }, { name: "Dup", phone: "9111111111" }))
      .rejects.toMatchObject({ status: 409 });
    // same phone, DIFFERENT owners → allowed
    await expect(svc.createCustomer({ ownerType: "seller", ownerId: sellerB }, { name: "Other seller", phone: "9111111111" })).resolves.toBeTruthy();
    await expect(svc.createCustomer({ ownerType: "company", ownerId: companyId }, { name: "Company", phone: "9111111111" })).resolves.toBeTruthy();
  });

  test("customerCode sequences are independent per owner", async () => {
    const a1 = await svc.createCustomer({ ownerType: "seller", ownerId: sellerA }, { name: "A1" });
    const b1 = await svc.createCustomer({ ownerType: "seller", ownerId: sellerB }, { name: "B1" });
    expect(a1.customerCode).toBe("CUST-0001");
    expect(b1.customerCode).toBe("CUST-0001"); // separate counter per owner
  });
});

describe("seller vs company controllers stay in their own scope", () => {
  const asSeller = (sellerId, body = {}, params = {}, query = {}) => ({ user: { sellerId, principalType: "seller" }, body, params, query });
  const asCompany = (cid, body = {}, params = {}, query = {}) => ({ user: { companyId: cid }, body, params, query });

  test("a seller's customer is invisible to the company controller and vice-versa", async () => {
    const sRes = mockRes();
    await sellerCust.create(asSeller(sellerA, { name: "Seller Cust", phone: "9222222222", type: "dealer" }), sRes);
    expect(sRes.statusCode).toBe(201);

    const cRes = mockRes();
    await companyCust.create(asCompany(companyId, { name: "Co Cust", phone: "9333333333" }), cRes);
    expect(cRes.statusCode).toBe(201);

    const sellerList = mockRes();
    await sellerCust.list(asSeller(sellerA), sellerList);
    expect(sellerList.body.count).toBe(1);
    expect(sellerList.body.data[0].name).toBe("Seller Cust");

    const companyList = mockRes();
    await companyCust.list(asCompany(companyId), companyList);
    expect(companyList.body.count).toBe(1);
    expect(companyList.body.data[0].name).toBe("Co Cust");
  });
});
