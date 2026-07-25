import express from "express";
import { getAllUsers, updateUserRole, deleteUser } from "../controllers/user.controller.js";
import { isAdmin } from "../middlewares/auth.middleware.js";

const router = express.Router();

// All user management routes require admin access
router.use(...isAdmin);

router.route("/")
  .get(getAllUsers);

router.route("/:id/role")
  .patch(updateUserRole);

router.route("/:id")
  .delete(deleteUser);

export default router;
