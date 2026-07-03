const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { createBody, receiveBody, writeoffBody } = require("../../validators/grnValidators");
const ctrl = require("../../controller/Inventory/grnController");

router.get("/", auth, authorize("grn:read"), ctrl.list);
router.get("/:id", auth, authorize("grn:read"), ctrl.get);

router.post("/", auth, authorize("grn:create"), validate({ body: createBody }), ctrl.create);
router.patch("/:id/receive", auth, authorize("grn:receive"), validate({ body: receiveBody }), ctrl.receive);
router.post("/:id/post", auth, authorize("grn:post"), ctrl.post);

// Damaged-stock write-off — restricted (Sprint 2.2 layers a formal approval flow on top).
router.post("/writeoff", auth, authorize("adjustment:approve"), validate({ body: writeoffBody }), ctrl.writeoff);

module.exports = router;
