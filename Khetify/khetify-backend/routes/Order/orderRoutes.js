const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { createOrderBody } = require("../../validators/salesValidators");
const {
  createOrder,
  getOrders,
  getSummary,
  getOrder,
  getPicklist,
  updateStatus,
  getHistory,
} = require("../../controller/Order/orderController");

router.post("/", auth, authorize("order:create"), validate({ body: createOrderBody }), createOrder);
router.get("/", auth, getOrders);
router.get("/summary", auth, getSummary);
router.get("/history", auth, getHistory);
router.get("/:id", auth, getOrder);
router.get("/:id/picklist", auth, getPicklist);
router.patch("/:id/status", auth, updateStatus);

module.exports = router;
