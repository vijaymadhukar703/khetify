const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { generateCountBody, submitCountBody } = require("../../validators/countValidators");
const ctrl = require("../../controller/Inventory/cycleCountController");

router.get("/", auth, authorize("count:read"), ctrl.list);
router.get("/:id", auth, authorize("count:read"), ctrl.get);

// Managers generate/finalize; operators only count (submit).
router.post("/generate", auth, authorize("count:create"), validate({ body: generateCountBody }), ctrl.generate);
router.patch("/:id/submit", auth, authorize("count:execute"), validate({ body: submitCountBody }), ctrl.submit);
router.post("/:id/complete", auth, authorize("count:review"), ctrl.complete);
router.post("/:id/cancel", auth, authorize("count:review"), ctrl.cancel);

module.exports = router;
