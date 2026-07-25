import User from "../models/user.model.js";

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
export const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find({}).select("-password").sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user role
// @route   PATCH /api/users/:id/role
// @access  Private/Admin
export const updateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Prevent changing the role of the main admin
    if (user.email === "admin@admin.com") {
      return res.status(403).json({ success: false, message: "Cannot change the role of the main admin" });
    }

    if (!["admin", "creator", "supporter"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role specified" });
    }

    user.role = role;
    await user.save();

    res.status(200).json({ success: true, message: "User role updated successfully", data: user });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
export const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Prevent deleting the main admin
    if (user.email === "admin@admin.com") {
      return res.status(403).json({ success: false, message: "Cannot delete the main admin" });
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    next(error);
  }
};
