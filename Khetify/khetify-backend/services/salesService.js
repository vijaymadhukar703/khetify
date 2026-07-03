const Company = require("../model/Company/Company");
const Product = require("../model/Company/productModel");
const Customer = require("../model/Sales/Customer");
const Order = require("../model/Order/Order");
const Seller = require("../model/Seller/Seller");
const lotService = require("./lotService");
const tax = require("./taxService");
const { nextSeq } = require("./counterService");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Accept an owner object { ownerType, ownerId } OR a bare companyId (legacy →
 * company owner), so existing company callers keep working unchanged. */
function normalizeOwner(owner) {
  if (owner && typeof owner === "object" && owner.ownerType) {
    return { ownerType: owner.ownerType, ownerId: owner.ownerId };
  }
  return { ownerType: "company", ownerId: owner };
}

/** Indian fiscal year code for a date, e.g. Jun-2026 → "2627" (FY 2026-27). */
function fiscalYearCode(d = new Date()) {
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1; // FY starts in April
  return `${String(startYear).slice(2)}${String(startYear + 1).slice(2)}`;
}

/** Gapless, monotonic invoice number per OWNER per FY (atomic counter). The
 * counter is keyed by ownerId; sellers get a distinct namespace from companies
 * since their ids differ. */
async function nextInvoiceNumber(ownerId, session) {
  const fy = fiscalYearCode();
  const seq = await nextSeq(ownerId, `inv-${fy}`, session);
  return `INV-${fy}-${String(seq).padStart(4, "0")}`;
}

function defaultAddress(customer) {
  if (!customer?.addresses?.length) return null;
  return customer.addresses.find((a) => a.isDefault) || customer.addresses[0];
}

/**
 * Create a confirmed sale order: resolves customer + per-line GST, RESERVES
 * stock FEFO (lot allocations stored on each line), and assigns a gapless
 * invoice number. Stock is committed later at dispatch.
 */
async function createOrder(owner, { customerId, items = [], salesChannel = "manual", channel = "offline", payment = {}, shippingAddress, billingAddress, orderNumber, performedBy }) {
  const { ownerType, ownerId } = normalizeOwner(owner);
  if (!items.length) throw httpErr("At least one line item is required");

  // The catalog company: for a company owner it's itself; for a seller it's the
  // supplying company whose products the seller resells.
  let catalogCompanyId = ownerType === "company" ? ownerId : null;
  if (ownerType === "seller") {
    const seller = await Seller.findById(ownerId).select("supplyingCompanyId linkStatus");
    if (!seller || seller.linkStatus !== "approved" || !seller.supplyingCompanyId) throw httpErr("No approved supplying company", 403);
    catalogCompanyId = seller.supplyingCompanyId;
  }

  const company = await Company.findById(catalogCompanyId).select("companyInfo");
  const companyStateCode = tax.stateCodeFromGstin(company?.companyInfo?.companyDocument?.gstinNumber);

  let customer = null;
  if (customerId) {
    customer = await Customer.findOne({ _id: customerId, ownerType, ownerId });
    if (!customer) throw httpErr("Customer not found", 404);
  }
  const custAddr = defaultAddress(customer);
  const customerStateCode = custAddr?.stateCode || tax.stateCodeFromGstin(customer?.gstin);

  // Resolve products from the catalog company (company's own, or the seller's
  // supplying company) and build priced, taxed lines.
  const productIds = items.map((i) => i.productId);
  const products = new Map((await Product.find({ _id: { $in: productIds }, companyId: catalogCompanyId })).map((p) => [String(p._id), p]));

  const lines = [];
  let totalUnits = 0, totalAmount = 0, totalTax = 0;
  for (const it of items) {
    const product = products.get(String(it.productId));
    if (!product) throw httpErr(`Product ${it.productId} not found`, 404);
    const qty = Number(it.qty);
    if (!qty || qty <= 0) throw httpErr("Each line needs a positive qty");
    const price = it.price != null ? Number(it.price) : (product.mrp || product.price || 0);
    const taxable = qty * price;
    const taxes = tax.computeLineTax({ taxable, gstRate: product.gstPercentage || 0, hsnCode: product.hsnCode, companyStateCode, customerStateCode });
    totalUnits += qty;
    totalAmount += taxable;
    totalTax += taxes.cgst + taxes.sgst + taxes.igst;
    lines.push({ productId: it.productId, name: product.productName, qty, price, taxes, allocations: [] });
  }

  // Reserve stock FEFO per line from the OWNER's stock (company or seller).
  for (const line of lines) {
    line.allocations = await lotService.allocateFEFO({ ownerType, ownerId, productId: line.productId, qty: line.qty, performedBy });
  }

  const invoiceNumber = await nextInvoiceNumber(ownerId);

  const order = await Order.create({
    ownerType,
    ownerId,
    // Keep companyId populated for company owners (backward-compatible shape /
    // existing companyId-scoped queries); sellers leave it unset.
    companyId: ownerType === "company" ? ownerId : undefined,
    orderNumber: orderNumber || invoiceNumber,
    invoiceNumber,
    customerId: customer?._id || null,
    customerName: customer?.name || undefined,
    billingAddress: billingAddress || custAddr || undefined,
    shippingAddress: shippingAddress || custAddr || undefined,
    items: lines,
    totalUnits,
    totalAmount: tax.round2(totalAmount),
    totalTax: tax.round2(totalTax),
    channel,
    salesChannel,
    payment: { mode: payment.mode, status: payment.status || "pending", txnRef: payment.txnRef },
    status: "confirmed",
  });
  return order;
}

module.exports = { createOrder, nextInvoiceNumber, fiscalYearCode };
