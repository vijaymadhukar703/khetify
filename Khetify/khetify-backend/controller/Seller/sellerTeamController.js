const bcrypt = require("bcryptjs");
const User = require("../../model/User/User");
const Warehouse = require("../../model/Warehouse/Warehouse");
const { SELLER_ASSIGNABLE_ROLES } = require("../../config/permissions");

/** Seller team members are owner-scoped: ownerType "seller", ownerId = seller account. */
const ownerScope = (req) => ({ ownerType: "seller", ownerId: req.user.sellerId });

/** Only warehouses owned by THIS seller can be assigned. */
async function validSellerWarehouses(sellerId, warehouseIds) {
  if (!Array.isArray(warehouseIds)) return undefined;
  if (!warehouseIds.length) return [];
  const count = await Warehouse.countDocuments({ _id: { $in: warehouseIds }, sellerId });
  if (count !== new Set(warehouseIds.map(String)).size) {
    const err = new Error("One or more warehouses don't belong to you");
    err.status = 400;
    throw err;
  }
  return warehouseIds;
}

/** GET /api/seller/team — the seller's team members. */
exports.getTeam = async (req, res) => {
  try {
    const rows = await User.find(ownerScope(req))
      .select("-passwordHash -pin")
      .populate("warehouseIds", "name code")
      .sort({ createdAt: -1 });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** POST /api/seller/team — invite a member with a SELLER role. */
exports.createMember = async (req, res) => {
  try {
    const { name, email, phone, role, password, warehouseIds } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name is required" });
    if (role && !SELLER_ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid seller role" });
    }
    const assigned = await validSellerWarehouses(req.user.sellerId, warehouseIds);
    const passwordHash = password ? await bcrypt.hash(String(password), 10) : undefined;
    const member = await User.create({
      ...ownerScope(req),
      name, email, phone,
      role: role || "seller_staff",
      status: password ? "active" : "invited",
      passwordHash,
      ...(assigned !== undefined && { warehouseIds: assigned }),
    });
    const out = member.toObject(); delete out.passwordHash; delete out.pin;
    res.status(201).json({ success: true, message: "Team member added", data: out });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** PATCH /api/seller/team/:id — role / status / warehouses. */
exports.updateMember = async (req, res) => {
  try {
    const patch = {};
    if (req.body.role) {
      if (!SELLER_ASSIGNABLE_ROLES.includes(req.body.role)) return res.status(400).json({ success: false, message: "Invalid seller role" });
      patch.role = req.body.role;
    }
    if (req.body.status) patch.status = req.body.status;
    if (req.body.name) patch.name = req.body.name;
    if (req.body.phone) patch.phone = req.body.phone;
    if (req.body.warehouseIds !== undefined) patch.warehouseIds = await validSellerWarehouses(req.user.sellerId, req.body.warehouseIds);
    if (req.body.password) patch.passwordHash = await bcrypt.hash(String(req.body.password), 10);

    const member = await User.findOneAndUpdate({ _id: req.params.id, ...ownerScope(req) }, patch, { new: true }).select("-passwordHash -pin");
    if (!member) return res.status(404).json({ success: false, message: "Team member not found" });
    res.json({ success: true, message: "Updated", data: member });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

/** DELETE /api/seller/team/:id */
exports.deleteMember = async (req, res) => {
  try {
    const r = await User.findOneAndDelete({ _id: req.params.id, ...ownerScope(req) });
    if (!r) return res.status(404).json({ success: false, message: "Team member not found" });
    res.json({ success: true, message: "Removed" });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};
