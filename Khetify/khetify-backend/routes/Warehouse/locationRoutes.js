const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { createBody, generateBody, moveBody, listQuery } = require("../../validators/locationValidators");
const ctrl = require("../../controller/Warehouse/locationController");

// Reads: any location-reading role. Writes: location:manage
// (company_admin "*" and warehouse_manager "location:*" qualify).
router.get("/", auth, authorize("location:read"), validate({ query: listQuery }), ctrl.list);
router.get("/bins", auth, authorize("location:read"), ctrl.bins);

router.post("/", auth, authorize("location:manage"), validate({ body: createBody }), ctrl.create);
router.post("/generate", auth, authorize("location:manage"), validate({ body: generateBody }), ctrl.generate);
router.post("/move", auth, authorize("location:manage"), validate({ body: moveBody }), ctrl.move);

module.exports = router;
