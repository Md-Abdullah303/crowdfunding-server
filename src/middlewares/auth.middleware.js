import { getAuth } from "../lib/auth.js";

/**
 * Verifies the Bearer token / session and attaches `req.user` to the request.
 * Must be used before any role-checking middleware.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const session = await getAuth().api.getSession({
      headers: req.headers,
    });

    if (!session || !session.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Please login to access this resource.",
      });
    }

    req.user = session.user;
    req.session = session.session;
    next();
  } catch (error) {
    console.error("❌ Auth middleware error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or expired session.",
    });
  }
};

/**
 * Factory: creates a middleware that allows only specified roles.
 * Usage: requireRole("admin"), requireRole("creator", "admin")
 */
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Not authenticated.",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: This resource requires role: ${allowedRoles.join(" or ")}.`,
      });
    }

    next();
  };
};

// ─── Shorthand Role Middlewares ────────────────────────────────────────────────

/** Requires user to be authenticated (any role) */
export const isAuthenticated = requireAuth;

/** Requires user to be an Admin */
export const isAdmin = [requireAuth, requireRole("admin")];

/** Requires user to be a Creator */
export const isCreator = [requireAuth, requireRole("creator")];

/** Requires user to be a Supporter */
export const isSupporter = [requireAuth, requireRole("supporter")];

/** Allows Admin or Creator */
export const isAdminOrCreator = [requireAuth, requireRole("admin", "creator")];
