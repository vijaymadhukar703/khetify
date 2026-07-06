const jwt = require("jsonwebtoken");

/**
 * Route-integrity guard (defence in depth, on top of per-route auth).
 *
 * A SELLER principal (token with principalType:"seller") may ONLY touch
 * /api/seller/* routes; a non-seller principal (company / driver / legacy
 * token) may NOT touch /api/seller/*. This stops a token minted for one portal
 * from being replayed against the other even when the role happens to hold a
 * matching capability (e.g. seller_admin's "*").
 *
 * The decision is made from the VERIFIED token only — never from any
 * client-supplied companyId/sellerId. It runs app-wide BEFORE the route mounts,
 * but only acts when a valid Bearer JWT is present: tokenless public routes
 * (login/register/marketing) and non-JWT auth (API-key machine plane) fall
 * through untouched so their own auth layer can respond.
 */
module.exports = function principalRouteGuard(req, res, next) {
  const path = req.path || req.originalUrl || "";
  if (!path.startsWith("/api/")) return next(); // non-API (static/uploads/healthz)

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) return next(); // public route or non-Bearer auth — inner layer decides

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next(); // malformed/expired token — let the route's authMiddleware 401
  }

  const isSeller = decoded.principalType === "seller";
  const isConsumer = decoded.principalType === "consumer";
  const isSellerRoute = path === "/api/seller" || path.startsWith("/api/seller/");
  const isShopRoute = path === "/api/shop" || path.startsWith("/api/shop/");

  // A CONSUMER (storefront) token may ONLY touch /api/shop/*, and only a
  // consumer token may reach the protected shop routes. (Public shop GETs carry
  // no token and fell through above.)
  if (isConsumer && !isShopRoute) {
    return res.status(403).json({ success: false, message: "Customer access only" });
  }
  if (isShopRoute && !isConsumer) {
    return res.status(403).json({ success: false, message: "Not a customer account" });
  }

  if (isSellerRoute && !isSeller) {
    return res.status(403).json({ success: false, message: "Seller access only" });
  }
  if (!isSellerRoute && isSeller) {
    return res.status(403).json({ success: false, message: "Company access only" });
  }
  return next();
};
