const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { completePutawayBody } = require("../../validators/grnValidators");
const ctrl = require("../../controller/Inventory/putawayController");

router.get("/", auth, authorize("putaway:read"), ctrl.list);
router.post("/:id/complete", auth, authorize("putaway:execute"), validate({ body: completePutawayBody }), ctrl.complete);

module.exports = router;
