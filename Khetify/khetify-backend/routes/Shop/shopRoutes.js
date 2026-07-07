const express = require("express");
const router = express.Router();

const consumerAuth = require("../../middlewares/consumerAuth");
const cat = require("../../controller/Shop/shopCatalogController");
const auth = require("../../controller/Shop/shopAuthController");
const order = require("../../controller/Shop/shopOrderController");

/* ─────────── Public storefront (no login) ─────────── */
router.get("/products", cat.listProducts);
router.get("/categories", cat.listCategories);
router.get("/products/:listingId", cat.getProduct);

/* ─────────── Consumer auth ─────────── */
router.post("/auth/register", auth.register);
router.post("/auth/login", auth.login);
router.post("/auth/verify-otp", consumerAuth, auth.verifyOtp);
router.post("/auth/resend-otp", consumerAuth, auth.resendOtp);
router.get("/auth/me", consumerAuth, auth.me);

/* ─────────── Protected: addresses, checkout, orders ─────────── */
router.get("/addresses", consumerAuth, order.listAddresses);
router.post("/addresses", consumerAuth, order.addAddress);
router.delete("/addresses/:addressId", consumerAuth, order.deleteAddress);

router.post("/checkout", consumerAuth, order.checkout);
router.get("/orders", consumerAuth, order.listOrders);
router.get("/orders/:id", consumerAuth, order.getOrder);

module.exports = router;
