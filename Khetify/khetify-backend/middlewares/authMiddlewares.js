const jwt = require("jsonwebtoken");

/**
 * Verifies the Bearer JWT and normalises req.user to ALWAYS carry
 * { id, companyId, role }.
 *
 * Backward compatibility:
 *  - Legacy company tokens were signed as { id } only. For those, id IS the
 *    companyId, so companyId falls back to id and role falls back to
 *    "company_admin" — preserving every existing controller that reads
 *    req.user.id as the company scope.
 *  - New tokens (Sprint 0) are signed as { id, companyId, role }.
 *  - Seller tokens are signed as { id, sellerId, principalType:"seller",
 *    role:"seller_admin" }. They carry sellerId and principalType so seller
 *    controllers scope by req.user.sellerId. companyId stays undefined for
 *    sellers (so a seller token can never resolve into the company scope),
 *    while company tokens keep companyId exactly as today.
 */
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "No token provided" });
    }

    // format: Bearer token
    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Invalid token format" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      ...decoded,
      id: decoded.id,
      // Seller tokens must NOT fall back to companyId === id (that would leak a
      // seller into the company scope); only company/legacy tokens do.
      companyId: decoded.companyId || (decoded.principalType === "seller" ? undefined : decoded.id),
      sellerId: decoded.sellerId, // present for seller tokens
      principalType: decoded.principalType || "company", // "company" | "seller"
      role: decoded.role || "company_admin", // legacy tokens carried no role
    };
    next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized", error: error.message });
  }
};

module.exports = authMiddleware;
