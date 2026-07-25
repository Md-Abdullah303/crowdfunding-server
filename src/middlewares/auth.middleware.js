/**
 * Middleware to verify JWT token and attach user to request.
 * To be implemented fully in Step 2 (Authentication setup).
 */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Unauthorized: No token provided" });
    }
    // JWT verification logic will be added after better-auth setup
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Unauthorized: Invalid token" });
  }
};

/**
 * Factory to create a role-checking middleware.
 * Usage: requireRole("admin"), requireRole("creator"), requireRole("supporter")
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Requires role(s): ${roles.join(", ")}`,
      });
    }
    next();
  };
};

module.exports = { verifyToken, requireRole };
