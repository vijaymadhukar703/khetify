const Notification = require("../../model/Notification/Notification");

/**
 * Seller notifications — the SAME notification system the company uses, but
 * scoped to the seller principal (recipientType "seller", recipientId =
 * req.user.sellerId). New ones are pushed live to the seller's socket room by
 * services/notificationService.notify() (event "notification:new").
 */

/** GET /api/seller/notifications — recent seller notifications, newest first. */
exports.getSellerNotifications = async (req, res) => {
  try {
    const rows = await Notification.find({ recipientType: "seller", recipientId: req.user.sellerId })
      .sort({ createdAt: -1 })
      .limit(100);
    const unread = rows.filter((n) => !n.read).length;
    res.json({ success: true, unread, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** PUT /api/seller/notifications/:id/read */
exports.markSellerNotificationRead = async (req, res) => {
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientType: "seller", recipientId: req.user.sellerId },
      { read: true },
      { new: true }
    );
    if (!n) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: n });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** PUT /api/seller/notifications/read-all */
exports.markAllSellerNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ recipientType: "seller", recipientId: req.user.sellerId, read: false }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
