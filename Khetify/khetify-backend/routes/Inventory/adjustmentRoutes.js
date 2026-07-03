const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { createAdjustmentBody } = require("../../validators/countValidators");
const ctrl = require("../../controller/Inventory/adjustmentController");

router.get("/", auth, authorize("inventory:read"), ctrl.list);
router.post("/", auth, authorize("adjustment:create"), validate({ body: createAdjustmentBody }), ctrl.create);

// Approve/apply and reject are restricted (segregation of duties; requester ≠ approver).
router.post("/:id/approve", auth, authorize("adjustment:approve"), ctrl.approve);
router.post("/:id/reject", auth, authorize("adjustment:approve"), ctrl.reject);

module.exports = router;
