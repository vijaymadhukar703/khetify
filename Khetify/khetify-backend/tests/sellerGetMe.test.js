const mongoose = require("mongoose");
require("../model/Company/Company");
const Seller = require("../model/Seller/Seller");
const User = require("../model/User/User");
const sellerAuth = require("../controller/Seller/sellerAuthController");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

let sellerId, member;
beforeEach(async () => {
  sellerId = (await Seller.create({
    email: `acct-${new mongoose.Types.ObjectId()}@x.com`, passwordHash: "x", status: "active",
    linkStatus: "approved", sellerInfo: { businessName: "Jain Beej Bhandar" },
  }))._id;
  member = await User.create({
    ownerType: "seller", ownerId: sellerId, name: "Ravi Kumar", email: "ravi@x.com", phone: "9000000000",
    role: "seller_manager", status: "active", passwordHash: "x",
  });
});

describe("getSellerMe — display profile", () => {
  test("a TEAM MEMBER sees their OWN name; business name is separate", async () => {
    const res = mockRes();
    await sellerAuth.getSellerMe({ user: { id: member._id, sellerId, principalType: "seller", role: "seller_manager" } }, res);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.name).toBe("Ravi Kumar");          // member's own name
    expect(d.businessName).toBe("Jain Beej Bhandar"); // account name kept separately
    expect(d.accountName).toBe("Jain Beej Bhandar");
    expect(d.isMember).toBe(true);
    expect(String(d.memberId)).toBe(String(member._id));
    expect(d.email).toBe("ravi@x.com");          // member's contact, not the account's
    expect(d.role).toBe("seller_manager");
    expect(String(d.sellerId)).toBe(String(sellerId));
    expect(Array.isArray(d.capabilities)).toBe(true);
  });

  test("the OWNER (admin) sees the business name as today", async () => {
    const res = mockRes();
    await sellerAuth.getSellerMe({ user: { id: sellerId, sellerId, principalType: "seller", role: "seller_admin" } }, res);
    const d = res.body.data;
    expect(d.name).toBe("Jain Beej Bhandar");
    expect(d.businessName).toBe("Jain Beej Bhandar");
    expect(d.isMember).toBe(false);
    expect(d.role).toBe("seller_admin");
  });
});
