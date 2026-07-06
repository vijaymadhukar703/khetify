const mongoose = require("mongoose");
const SellerListing = require("../model/PC/SellerListing");
const Product = require("../model/Company/productModel");
const Seller = require("../model/Seller/Seller");
const Company = require("../model/Company/Company");
const Inventory = require("../model/Inventory/Inventory");

/**
 * Public storefront catalog (customer-shop). Surfaces every seller's PUBLISHED
 * marketplace listing (SellerListing.status === "published" — i.e. exactly what
 * the seller creates via "Publish on marketplace") joined with its product,
 * seller, company and LIVE stock. No auth — a shopper browses freely and only
 * logs in at checkout. Nothing here is hardcoded: unpublishing a listing (or
 * deactivating the product) makes it disappear immediately.
 *
 * A "shop product" is a listing (not a bare product): the same product resold
 * by two sellers is two storefront cards, each priced/stocked by that seller.
 *
 * Stock is the seller's own availableStock (Inventory rows where
 * ownerType:"seller", ownerId:sellerId) — the ONLY number the marketplace reads
 * for "in stock?".
 */

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** The unit price a shopper pays: the seller's listing price, else product MRP/price. */
function listingPrice(listing, product) {
  if (listing.price != null) return listing.price;
  return product?.mrp ?? product?.price ?? 0;
}

/** Sum a seller's live availableStock for a set of (sellerId, productId) pairs.
 * Returns a Map keyed by `${sellerId}:${productId}` → number. */
async function stockMap(pairs) {
  if (!pairs.length) return new Map();
  const productIds = [...new Set(pairs.map((p) => String(p.productId)))].map((id) => new mongoose.Types.ObjectId(id));
  const sellerIds = [...new Set(pairs.map((p) => String(p.sellerId)))].map((id) => new mongoose.Types.ObjectId(id));
  const rows = await Inventory.aggregate([
    { $match: { ownerType: "seller", ownerId: { $in: sellerIds }, productId: { $in: productIds } } },
    { $group: { _id: { ownerId: "$ownerId", productId: "$productId" }, avail: { $sum: "$availableStock" } } },
  ]);
  const map = new Map();
  for (const r of rows) map.set(`${r._id.ownerId}:${r._id.productId}`, r.avail);
  return map;
}

/** Shape one listing+product+seller into the card/detail payload sent to the UI. */
function toShopProduct(listing, product, seller, company, availableStock) {
  const price = listingPrice(listing, product);
  const stock = Number.isFinite(availableStock) ? availableStock : (product.availableStock ?? 0);
  return {
    listingId: String(listing._id),
    sellerId: String(listing.sellerId),
    companyId: String(listing.companyId),
    productId: String(product._id),
    name: product.productName,
    brand: product.brandName,
    sku: product.skuNumber || null,
    category: product.category,
    description: product.description,
    unit: product.unit,
    unitType: product.unitType,
    images: product.productImages || [],
    price,
    mrp: product.mrp ?? null,
    gstPercentage: product.gstPercentage || 0,
    availableStock: stock,
    inStock: stock > 0,
    minimumOrderQuantity: product.minimumOrderQuantity || 1,
    seller: seller
      ? {
          id: String(seller._id),
          name: seller.sellerInfo?.businessName || seller.contact?.ownerName || "Seller",
          city: seller.contact?.address?.city,
          state: seller.contact?.address?.state,
        }
      : null,
    companyName: company?.companyInfo?.companyName || null,
    publishedAt: listing.publishedAt,
  };
}

/**
 * List published storefront products.
 * @param {object} q { search, category, minPrice, maxPrice, sort, page, limit, inStockOnly }
 */
async function listProducts(q = {}) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(60, Math.max(1, Number(q.limit) || 24));

  // 1. Published listings only.
  const listings = await SellerListing.find({ status: "published" }).lean();
  if (!listings.length) return { items: [], total: 0, page, limit, categories: [] };

  // 2. Load referenced products + sellers + companies + live stock.
  const productIds = [...new Set(listings.map((l) => String(l.productId)))];
  const sellerIds = [...new Set(listings.map((l) => String(l.sellerId)))];
  const companyIds = [...new Set(listings.map((l) => String(l.companyId)))];
  const [products, sellers, companies, stocks] = await Promise.all([
    Product.find({ _id: { $in: productIds }, productStatus: "active" }).lean(),
    Seller.find({ _id: { $in: sellerIds } }).select("sellerInfo contact").lean(),
    Company.find({ _id: { $in: companyIds } }).select("companyInfo.companyName").lean(),
    stockMap(listings.map((l) => ({ sellerId: l.sellerId, productId: l.productId }))),
  ]);
  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const sellerMap = new Map(sellers.map((s) => [String(s._id), s]));
  const companyMap = new Map(companies.map((c) => [String(c._id), c]));

  // 3. Join → only listings whose product is active/present.
  let items = [];
  const categorySet = new Set();
  for (const l of listings) {
    const product = productMap.get(String(l.productId));
    if (!product) continue; // inactive/deleted product → hide the listing
    if (product.category) categorySet.add(product.category);
    const stock = stocks.get(`${l.sellerId}:${l.productId}`);
    items.push(toShopProduct(l, product, sellerMap.get(String(l.sellerId)), companyMap.get(String(l.companyId)), stock));
  }

  // 4. Filters (in-memory — the marketplace is small; revisit with an aggregate
  //    pipeline / text index when the catalog grows).
  const search = (q.search || "").trim().toLowerCase();
  if (search) {
    items = items.filter((it) =>
      [it.name, it.brand, it.category, it.sku, it.companyName, it.seller?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(search))
    );
  }
  if (q.category) items = items.filter((it) => it.category === q.category);
  if (q.minPrice != null && q.minPrice !== "") items = items.filter((it) => it.price >= Number(q.minPrice));
  if (q.maxPrice != null && q.maxPrice !== "") items = items.filter((it) => it.price <= Number(q.maxPrice));
  if (q.inStockOnly === "true" || q.inStockOnly === true) items = items.filter((it) => it.inStock);

  // 5. Sort. In-stock always ranks above out-of-stock, then by the chosen key.
  const key = {
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    name_asc: (a, b) => String(a.name).localeCompare(String(b.name)),
  }[q.sort] || ((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)); // newest
  items.sort((a, b) => (Number(b.inStock) - Number(a.inStock)) || key(a, b));

  const total = items.length;
  const start = (page - 1) * limit;
  const paged = items.slice(start, start + limit);

  return { items: paged, total, page, limit, categories: [...categorySet].sort() };
}

/** Distinct categories across published, active listings (for the shop nav). */
async function listCategories() {
  const { categories } = await listProducts({ limit: 1, page: 1 });
  return categories;
}

/** One product detail card by its LISTING id. */
async function getProduct(listingId) {
  if (!mongoose.isValidObjectId(listingId)) throw httpErr("Product not found", 404);
  const listing = await SellerListing.findOne({ _id: listingId, status: "published" }).lean();
  if (!listing) throw httpErr("Product not found", 404);
  const [product, seller, company, stocks] = await Promise.all([
    Product.findOne({ _id: listing.productId, productStatus: "active" }).lean(),
    Seller.findById(listing.sellerId).select("sellerInfo contact").lean(),
    Company.findById(listing.companyId).select("companyInfo.companyName").lean(),
    stockMap([{ sellerId: listing.sellerId, productId: listing.productId }]),
  ]);
  if (!product) throw httpErr("Product not found", 404);
  const stock = stocks.get(`${listing.sellerId}:${listing.productId}`);
  return toShopProduct(listing, product, seller, company, stock);
}

/**
 * Resolve a set of listing ids into trusted, priced+stocked line data for
 * checkout — NEVER trust prices/stock from the client. Returns a map keyed by
 * listingId.
 */
async function resolveForCheckout(listingIds = []) {
  const ids = [...new Set(listingIds.map(String))].filter((id) => mongoose.isValidObjectId(id));
  const listings = await SellerListing.find({ _id: { $in: ids }, status: "published" }).lean();
  const productIds = listings.map((l) => l.productId);
  const [products, stocks] = await Promise.all([
    Product.find({ _id: { $in: productIds }, productStatus: "active" }).lean(),
    stockMap(listings.map((l) => ({ sellerId: l.sellerId, productId: l.productId }))),
  ]);
  const productMap = new Map(products.map((p) => [String(p._id), p]));

  const map = new Map();
  for (const l of listings) {
    const product = productMap.get(String(l.productId));
    if (!product) continue;
    const stock = stocks.get(`${l.sellerId}:${l.productId}`);
    map.set(String(l._id), {
      listingId: String(l._id),
      sellerId: String(l.sellerId),
      companyId: String(l.companyId),
      productId: String(l.productId),
      name: product.productName,
      price: listingPrice(l, product),
      gstPercentage: product.gstPercentage || 0,
      hsnCode: product.hsnCode,
      availableStock: Number.isFinite(stock) ? stock : (product.availableStock ?? 0),
    });
  }
  return map;
}

module.exports = { listProducts, listCategories, getProduct, resolveForCheckout };
