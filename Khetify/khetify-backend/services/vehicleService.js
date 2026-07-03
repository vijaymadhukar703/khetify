const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Vehicle = require("../model/Transport/Vehicle");
const DriverProfile = require("../model/Transport/DriverProfile");
const User = require("../model/User/User");

function httpErr(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* ---- vehicles ---- */
async function listVehicles(companyId) {
  return Vehicle.find({ companyId }).sort({ createdAt: -1 });
}
async function createVehicle(companyId, body) {
  if (!body.regNo) throw httpErr("regNo is required");
  try {
    return await Vehicle.create({ ...body, companyId });
  } catch (err) {
    if (err.code === 11000) throw httpErr("A vehicle with this registration already exists", 409);
    throw err;
  }
}
async function updateVehicle(companyId, id, patch) {
  const v = await Vehicle.findOneAndUpdate({ _id: id, companyId }, patch, { new: true });
  if (!v) throw httpErr("Vehicle not found", 404);
  return v;
}

/* ---- drivers (User role:driver + DriverProfile) ---- */
async function listDrivers(companyId) {
  const profiles = await DriverProfile.find({ companyId }).populate("userId", "name phone status").populate("vehicleId", "regNo");
  return profiles;
}

async function createDriver(companyId, { name, phone, pin, email, licenseNo, licenseExpiry, vehicleId }) {
  if (!name || !phone || !pin) throw httpErr("name, phone and pin are required");
  const exists = await User.findOne({ companyId, phone, role: "driver" });
  if (exists) throw httpErr("A driver with this phone already exists", 409);
  const pinHash = await bcrypt.hash(String(pin), 10);
  const user = await User.create({ companyId, name, phone, email, role: "driver", status: "active", pin: pinHash });
  const profile = await DriverProfile.create({ companyId, userId: user._id, phone, licenseNo, licenseExpiry, vehicleId: vehicleId || null });
  return { user: { _id: user._id, name: user.name, phone: user.phone }, profile };
}

async function updateDriver(companyId, userId, { licenseNo, licenseExpiry, vehicleId, pin, status }) {
  const profile = await DriverProfile.findOneAndUpdate({ companyId, userId }, { licenseNo, licenseExpiry, vehicleId }, { new: true });
  if (!profile) throw httpErr("Driver not found", 404);
  const userPatch = {};
  if (status) userPatch.status = status;
  if (pin) userPatch.pin = await bcrypt.hash(String(pin), 10);
  if (Object.keys(userPatch).length) await User.updateOne({ _id: userId, companyId }, userPatch);
  return profile;
}

/* ---- driver mobile login (phone + PIN) ---- */
async function driverLogin({ phone, pin }) {
  if (!phone || !pin) throw httpErr("phone and pin are required");
  const user = await User.findOne({ phone, role: "driver", status: "active" });
  if (!user || !user.pin) throw httpErr("Invalid credentials", 401);
  const ok = await bcrypt.compare(String(pin), user.pin);
  if (!ok) throw httpErr("Invalid credentials", 401);
  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  const token = jwt.sign({ id: user._id, companyId: user.companyId, role: "driver" }, process.env.JWT_SECRET, { expiresIn: "7d" });
  return { token, driver: { id: user._id, name: user.name, phone: user.phone } };
}

module.exports = { listVehicles, createVehicle, updateVehicle, listDrivers, createDriver, updateDriver, driverLogin };
