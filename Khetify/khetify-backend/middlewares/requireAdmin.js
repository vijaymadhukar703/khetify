const jwt = require("jsonwebtoken");

/**
 * Guards the platform admin API. Verifies the Bearer JWT and requires an ADMIN
 * token: { principalType:"admin", role:"super_admin" }. Deliberately does NOT
 * set req.user.companyId — an admin token can never resolve into a company/seller
 * tenant scope. Company/seller tokens (no principalType:"admin") are rejected.
 */
const requireAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: "No token provided" });

    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ success: false, message: "Invalid token format" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.principalType !== "admin" || decoded.role !== "super_admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    req.admin = { id: decoded.id, role: decoded.role };
    req.user = { id: decoded.id, role: decoded.role, principalType: "admin" };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Unauthorized", error: error.message });
  }
};

module.exports = requireAdmin;
