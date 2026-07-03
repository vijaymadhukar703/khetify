const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const requireApprovedSeller = require("../../middlewares/requireApprovedSeller");
const authorize = require("../../middlewares/authorize");
const { getSellerProducts, getSellerProduct } = require("../../controller/Seller/sellerCatalogController");

// Read-only catalog of the linked company's products. Approved sellers only.
// Gated by catalog:read — a warehouse manager (seller_manager) has NO catalog
// capability, so they are blocked here server-side (the nav is also hidden).
router.use(auth, requireApprovedSeller, authorize("catalog:read"));
router.get("/", getSellerProducts);
router.get("/:id", getSellerProduct);

module.exports = router;
