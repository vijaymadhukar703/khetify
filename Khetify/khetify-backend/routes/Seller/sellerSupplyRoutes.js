const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const { createSellerSupplyOrder, getSellerSupplyOrders, receiveSupply } = require("../../controller/Seller/sellerSupplyController");

// Seller-initiated supply requests. Approved sellers only; scoped to the seller.
router.use(auth, requireApprovedSeller);
router.post("/", createSellerSupplyOrder);
router.get("/", getSellerSupplyOrders);
router.post("/:id/receive", receiveSupply); // scan-verify + receive into seller stock

module.exports = router;
