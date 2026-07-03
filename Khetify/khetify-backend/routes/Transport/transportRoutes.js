const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const {
  getShipments,
  createShipment,
  updateShipmentStatus,
} = require("../../controller/Transport/transportController");

router.get("/", auth, getShipments);
router.post("/", auth, createShipment);
router.patch("/:id/status", auth, updateShipmentStatus);

module.exports = router;
