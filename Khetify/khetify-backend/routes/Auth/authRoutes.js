const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const { me } = require("../../controller/Auth/authController");

// Current principal + capabilities. Used by the frontend usePermission() hook.
router.get("/me", auth, me);

module.exports = router;
