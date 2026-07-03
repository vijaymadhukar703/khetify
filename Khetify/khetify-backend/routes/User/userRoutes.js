const express = require("express");
const router = express.Router();

const auth = require("../../middlewares/authMiddlewares");
const authorize = require("../../middlewares/authorize");
const validate = require("../../middlewares/validate");
const { createUserBody, updateUserBody, loginUserBody } = require("../../validators/userValidators");
const {
  loginUser,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
} = require("../../controller/User/userController");

// Team-member login (no auth — issues the JWT). Owners use /api/company/login.
router.post("/login", validate({ body: loginUserBody }), loginUser);

// Company tokens carry role "company_admin" (holds "*"), so existing behaviour
// is unchanged. Sub-user roles are gated by the user:* capabilities below.
router.get("/", auth, authorize("user:read"), getUsers);
router.post("/", auth, authorize("user:create"), validate({ body: createUserBody }), createUser);
router.patch("/:id", auth, authorize("user:update"), validate({ body: updateUserBody }), updateUser);
router.delete("/:id", auth, authorize("user:delete"), deleteUser);

module.exports = router;
