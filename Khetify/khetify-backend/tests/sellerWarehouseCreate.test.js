const { hasCapability } = require("../config/permissions");
const authorize = require("../middlewares/authorize");

function mockRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const runAuth = (role, cap) => { let n = false; const res = mockRes(); authorize(cap)({ user: { role } }, res, () => { n = true; }); return { n, code: res.statusCode }; };

describe("creating a seller warehouse is seller_admin-only", () => {
  test("warehouse:create is held by seller_admin ONLY", () => {
    expect(hasCapability("seller_admin", "warehouse:create")).toBe(true);
    expect(hasCapability("seller_manager", "warehouse:create")).toBe(false); // no wildcard → blocked
    expect(hasCapability("seller_staff", "warehouse:create")).toBe(false);
  });

  test("the manager KEEPS read + edit/deactivate (warehouse:manage), loses only create", () => {
    expect(hasCapability("seller_manager", "warehouse:read")).toBe(true);
    expect(hasCapability("seller_manager", "warehouse:manage")).toBe(true); // edit/deactivate intact
    expect(hasCapability("seller_staff", "warehouse:read")).toBe(true);
    expect(hasCapability("seller_staff", "warehouse:manage")).toBe(false);
  });

  test("authorize('warehouse:create') blocks the manager, allows the admin", () => {
    expect(runAuth("seller_manager", "warehouse:create").code).toBe(403);
    expect(runAuth("seller_staff", "warehouse:create").code).toBe(403);
    expect(runAuth("seller_admin", "warehouse:create").n).toBe(true);
    // edit/deactivate guard still lets the manager through
    expect(runAuth("seller_manager", "warehouse:manage").n).toBe(true);
  });

  test("company RBAC unchanged (warehouse:manage still admin-only there)", () => {
    expect(hasCapability("company_admin", "warehouse:manage")).toBe(true);
    expect(hasCapability("operations_manager", "warehouse:manage")).toBe(false);
    expect(hasCapability("operations_manager", "warehouse:create")).toBe(false);
  });
});
