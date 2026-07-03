const Customer = require("../model/Sales/Customer");
const Order = require("../model/Order/Order");
const UnitSerial = require("../model/Barcode/UnitSerial");
const { nextSeq } = require("./counterService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Owner scoping. Accepts EITHER an owner object { ownerType, ownerId } OR a bare
 * companyId (legacy → company owner), so existing callers keep working while
 * seller callers pass an explicit owner. Returns both the owner pair and a
 * Mongo `scope` filter for find/update.
 */
function normalizeOwner(owner) {
  if (owner && typeof owner === "object" && owner.ownerType) {
    return { ownerType: owner.ownerType, ownerId: owner.ownerId };
  }
  return { ownerType: "company", ownerId: owner };
}

/** customerCode sequence per owner. Company keeps the "cust" counter (scoped by
 * companyId) so its numbering is unchanged; sellers use a distinct counter. */
async function nextCustomerCode({ ownerType, ownerId }) {
  const key = ownerType === "company" ? "cust" : "cust-seller";
  const seq = await nextSeq(ownerId, key);
  return `CUST-${String(seq).padStart(4, "0")}`;
}

/** Create a customer, deduping on phone within the OWNER. */
async function createCustomer(owner, body) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  if (!body.name) throw httpErr("name is required");
  if (body.phone) {
    const existing = await Customer.findOne({ ownerType, ownerId, phone: body.phone });
    if (existing) throw httpErr("A customer with this phone already exists", 409);
  }
  const customerCode = await nextCustomerCode({ ownerType, ownerId });
  // Keep companyId populated for company owners (backward compatibility with
  // existing queries/shape); sellers leave it unset.
  const companyId = ownerType === "company" ? ownerId : undefined;
  return Customer.create({ ...body, ownerType, ownerId, companyId, customerCode });
}

async function updateCustomer(owner, id, patch) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const allowed = ["name", "type", "phone", "email", "gstin", "addresses", "creditLimit", "tags", "isActive"];
  const set = {};
  for (const k of allowed) if (patch[k] !== undefined) set[k] = patch[k];
  if (set.phone) {
    const clash = await Customer.findOne({ ownerType, ownerId, phone: set.phone, _id: { $ne: id } });
    if (clash) throw httpErr("Another customer already uses this phone", 409);
  }
  const c = await Customer.findOneAndUpdate({ _id: id, ownerType, ownerId }, set, { new: true });
  if (!c) throw httpErr("Customer not found", 404);
  return c;
}

async function listCustomers(owner, { q, limit = 200 } = {}) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const filter = { ownerType, ownerId };
  if (q) filter.$or = [{ name: new RegExp(q, "i") }, { phone: new RegExp(q, "i") }, { customerCode: new RegExp(q, "i") }];
  return Customer.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 200, 1000));
}

async function getCustomer(owner, id) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const c = await Customer.findOne({ _id: id, ownerType, ownerId });
  if (!c) throw httpErr("Customer not found", 404);
  return c;
}

/** Purchase history: orders + the lots/serials each contained (owner-scoped). */
async function getHistory(owner, id) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  const customer = await getCustomer({ ownerType, ownerId }, id);
  // Orders/units are company-scoped by companyId today; preserve that exact
  // filter for company owners (unchanged behaviour). Seller orders arrive in
  // Phase 5b — scope those by (ownerType, ownerId); empty until then.
  const ledgerScope = ownerType === "company" ? { companyId: ownerId } : { ownerType, ownerId };
  const orders = await Order.find({ ...ledgerScope, customerId: id })
    .select("orderNumber invoiceNumber status totalAmount totalUnits placedAt items.name items.qty items.allocations")
    .sort({ placedAt: -1 });
  const serials = await UnitSerial.countDocuments({ ...ledgerScope, customerId: id });
  return { customer, orders, serialUnitsSold: serials };
}

module.exports = { createCustomer, updateCustomer, listCustomers, getCustomer, getHistory };
