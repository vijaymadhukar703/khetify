const authService = require("../../services/shopAuthService");

exports.register = async (req, res) => {
  try {
    const result = await authService.register(req.body);
    res.status(201).json({ success: true, message: "Account created", ...result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.login = async (req, res) => {
  try {
    const result = await authService.login(req.body);
    res.json({ success: true, message: "Logged in", ...result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const result = await authService.verifyEmailOtp(req.consumer.id, req.body.code);
    res.json({ success: true, message: "Email verified", ...result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.resendOtp = async (req, res) => {
  try {
    const result = await authService.resendEmailOtp(req.consumer.id);
    res.json({ success: true, message: "Verification code sent", ...result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};

exports.me = async (req, res) => {
  try {
    const consumer = await authService.getMe(req.consumer.id);
    res.json({ success: true, data: consumer });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
  }
};
