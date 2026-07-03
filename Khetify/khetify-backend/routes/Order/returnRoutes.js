const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { createBody } = require("../../validators/returnValidators");
const ctrl = require("../../controller/Order/returnController");

router.get("/", auth, authorize("return:read"), ctrl.list);
router.post("/", auth, authorize("return:create"), validate({ body: createBody }), ctrl.create);
router.post("/:id/post", auth, authorize("return:post"), ctrl.post);

module.exports = router;
