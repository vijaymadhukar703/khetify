const jwt = require("jsonwebtoken");

/**
 * Verifies a storefront (customer-shop) consumer JWT and sets req.consumer.
 *
 * Consumer tokens are signed as { id, principalType: "consumer" }. This guard
 * is deliberately SEPARATE from authMiddleware (company/seller principals) so a
 * consumer token can never resolve into a company/seller scope, and vice-versa.
 */
module.exports = function consumerAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: "No token provided" });

    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ success: false, message: "Invalid token format" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.principalType !== "consumer") {
      return res.status(403).json({ success: false, message: "Not a customer account" });
    }

    req.consumer = { id: decoded.id };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Unauthorized", error: error.message });
  }
};
