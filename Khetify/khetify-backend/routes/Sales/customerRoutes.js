const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { createCustomerBody, updateCustomerBody } = require("../../validators/salesValidators");
const ctrl = require("../../controller/Sales/customerController");

router.get("/", auth, authorize("customer:read"), ctrl.list);
router.get("/:id", auth, authorize("customer:read"), ctrl.get);
router.get("/:id/history", auth, authorize("customer:read"), ctrl.history);
router.post("/", auth, authorize("customer:create"), validate({ body: createCustomerBody }), ctrl.create);
router.patch("/:id", auth, authorize("customer:update"), validate({ body: updateCustomerBody }), ctrl.update);

module.exports = router;
