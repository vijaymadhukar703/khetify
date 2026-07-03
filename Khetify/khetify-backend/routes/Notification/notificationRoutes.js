const express = require("express");
const router = express.Router();
const auth = require("../../middlewares/authMiddlewares");
const {
  getNotifications,
  markRead,
  markAllRead,
  scanAlerts,
} = require("../../controller/Notification/notificationController");

router.get("/", auth, getNotifications);
router.put("/read-all", auth, markAllRead);
router.put("/:id/read", auth, markRead);
router.post("/scan", auth, scanAlerts);

module.exports = router;
