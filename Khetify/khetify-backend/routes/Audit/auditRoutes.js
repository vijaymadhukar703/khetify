const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const ctrl = require("../../controller/Audit/auditController");

router.get("/", auth, authorize("audit:read"), ctrl.list);
router.post("/reconcile", auth, authorize("audit:read"), ctrl.reconcile);

module.exports = router;
