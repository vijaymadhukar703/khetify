const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../../model/User/User");
const audit = require("../../services/auditService");
const { ASSIGNABLE_ROLES } = require("../../config/permissions");
const Warehouse = require("../../model/Warehouse/Warehouse");

/** Tenant safety: only warehouses belonging to THIS company can be assigned. */
async function validCompanyWarehouses(companyId, warehouseIds) {
  if (!Array.isArray(warehouseIds)) return undefined;
  if (!warehouseIds.length) return [];
  const count = await Warehouse.countDocuments({ _id: { $in: warehouseIds }, companyId });
  if (count !== new Set(warehouseIds.map(String)).size) {
    const err = new Error("One or more warehouses don't belong to this company");
    err.status = 400;
    throw err;
  }
  return warehouseIds;
}

/**
 * POST /api/users/login  { email | phone, password }
 * Team-member login (operations_manager, sales_manager, ...). Issues the same
 * JWT shape the rest of the stack expects — { id, companyId, role } — so
 * authorize() and the frontend usePermission() gating work out of the box.
 * The company owner keeps logging in via POST /api/company/login (unchanged).
 */
exports.loginUser = async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    if (!password || (!email && !phone)) {
      return res.status(400).json({ success: false, message: "Email/Phone and password required" });
    }

    const query = [];
    if (email) query.push({ email: String(email).toLowerCase().trim() });
    if (phone) query.push({ phone: String(phone).trim() });

    // SECURITY: the User collection holds BOTH company and seller members
    // (ownerType "company" | "seller"). This is the COMPANY team-login endpoint,
    // so it must match COMPANY members only — a seller member's credentials must
    // NOT authenticate here. Sellers sign in via /api/seller/login. We return the
    // SAME generic "Invalid credentials" so we never reveal the account exists on
    // the other side.
    const user = await User.findOne({ ownerType: "company", $or: query });
    if (!user || !user.passwordHash) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ success: false, message: `Account is ${user.status} — ask your company admin` });
    }

    const isMatch = await bcrypt.compare(String(password).trim(), user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, companyId: user.companyId, role: user.role, warehouseIds: (user.warehouseIds || []).map(String) },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    user.lastLoginAt = new Date();
    await user.save();

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        companyId: user.companyId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        warehouseIds: user.warehouseIds || [],
      },
    });
  } catch (err) {
    console.error("loginUser error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** GET /api/users — team members for the company. */
exports.getUsers = async (req, res) => {
  try {
    const rows = await User.find({ companyId: req.user.companyId })
      .select("-passwordHash")
      .populate("warehouseIds", "name code")
      .sort({ createdAt: -1 });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error("getUsers error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** POST /api/users  { name, email, role, password? } */
exports.createUser = async (req, res) => {
  try {
    const { name, email, phone, role, password, warehouseIds } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name is required" });
    if (role && !ASSIGNABLE_ROLES.includes(role))
      return res.status(400).json({ success: false, message: "Invalid role" });

    const assignedWarehouses = await validCompanyWarehouses(req.user.companyId, warehouseIds);
    const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
    const user = await User.create({
      companyId: req.user.companyId,
      name,
      email,
      phone,
      role: role || "operations_manager",
      status: password ? "active" : "invited",
      passwordHash,
      ...(assignedWarehouses !== undefined && { warehouseIds: assignedWarehouses }),
    });
    await audit.log({
      req,
      action: "user.created",
      entityType: "User",
      entityId: user._id,
      after: { name: user.name, email: user.email, role: user.role, warehouseIds: user.warehouseIds },
    });
    const out = user.toObject();
    delete out.passwordHash;
    res.json({ success: true, message: "Team member added", data: out });
  } catch (err) {
    console.error("createUser error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** PATCH /api/users/:id  { role?, status? } */
exports.updateUser = async (req, res) => {
  try {
    const patch = {};
    if (req.body.role) {
      if (!ASSIGNABLE_ROLES.includes(req.body.role))
        return res.status(400).json({ success: false, message: "Invalid role" });
      patch.role = req.body.role;
    }
    if (req.body.status) patch.status = req.body.status;
    if (req.body.name) patch.name = req.body.name;
    if (req.body.phone) patch.phone = req.body.phone;
    if (req.body.warehouseIds !== undefined) {
      patch.warehouseIds = await validCompanyWarehouses(req.user.companyId, req.body.warehouseIds);
    }

    const prev = await User.findOne({ _id: req.params.id, companyId: req.user.companyId }).select(
      "-passwordHash"
    );
    if (!prev) return res.status(404).json({ success: false, message: "User not found" });

    const user = await User.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId },
      patch,
      { new: true }
    ).select("-passwordHash");

    if (patch.warehouseIds !== undefined && String(prev.warehouseIds) !== String(patch.warehouseIds)) {
      await audit.log({
        req,
        action: "user.warehouses_assigned",
        entityType: "User",
        entityId: user._id,
        before: { warehouseIds: prev.warehouseIds },
        after: { warehouseIds: user.warehouseIds },
      });
    }
    if (patch.role && patch.role !== prev.role) {
      await audit.log({
        req,
        action: "user.role_changed",
        entityType: "User",
        entityId: user._id,
        before: { role: prev.role },
        after: { role: user.role },
      });
    }
    res.json({ success: true, message: "Updated", data: user });
  } catch (err) {
    console.error("updateUser error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** DELETE /api/users/:id */
exports.deleteUser = async (req, res) => {
  try {
    const r = await User.findOneAndDelete({ _id: req.params.id, companyId: req.user.companyId });
    if (!r) return res.status(404).json({ success: false, message: "User not found" });
    await audit.log({
      req,
      action: "user.deleted",
      entityType: "User",
      entityId: r._id,
      before: { name: r.name, role: r.role },
    });
    res.json({ success: true, message: "Removed" });
  } catch (err) {
    console.error("deleteUser error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
