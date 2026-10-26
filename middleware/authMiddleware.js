// middleware/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Professional from "../models/Professional.js";

const safeStr = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

export const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers?.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "Not authorized, token missing" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[auth] token verify error:", err);
      }
      return res.status(401).json({ success: false, message: "Token invalid or expired" });
    }

    if (!decoded?.id) {
      return res.status(401).json({ success: false, message: "Token invalid" });
    }

    // Try loading as User first
    let user = null;
    try {
      user = await User.findById(decoded.id).select("-password").lean();
    } catch (err) {
      // ignore cast errors here
      user = null;
    }

    if (user) {
      // ensure _id is a string for downstream code
      user._id = String(user._id);
      req.user = user;
      req.userType = "User";
      return next();
    }

    // Try as Professional
    let professional = null;
    try {
      professional = await Professional.findById(decoded.id).select("-password").lean();
    } catch (err) {
      professional = null;
    }

    if (professional) {
      professional._id = String(professional._id);
      req.user = professional;
      req.userType = "Professional";
      return next();
    }

    // Optionally debug token payload and headers in non-prod
    if (process.env.NODE_ENV !== "production") {
      console.debug("[AUTH DEBUG] token present, decoded:", decoded);
      console.debug("[AUTH DEBUG] headers.authorization:", req.headers.authorization);
      console.debug("[AUTH DEBUG] cookies:", req.cookies);
    }

    // Not found in either collection
    return res.status(401).json({ success: false, message: "User not found" });
  } catch (err) {
    console.error("[auth middleware error]:", err);
    return res
      .status(401)
      .json({ success: false, message: "Not authorized, token failed", error: err.message });
  }
};

export const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }
  const role = safeStr(req.user.role);
  if (role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  return next();
};

export const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }

  const allowedSet = new Set(allowedRoles.map((r) => safeStr(r)));
  const userRole = safeStr(req.user.role || "");
  if ((!userRole || userRole === "") && req.userType === "Professional" && allowedSet.has("professional")) {
    return next();
  }

  if (!allowedSet.has(userRole)) {
    return res.status(403).json({
      success: false,
      message: `Access denied: requires one of [${Array.from(allowedSet).join(", ")}]`,
    });
  }

  return next();
};

export const requireProfessionalOrAdminForTarget = (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authorized" });

    const role = String((req.user.role || "")).toLowerCase();

    const PROFESSIONAL = new Set(["professional","counsellor","counselor","therapist","mediator","lawyer"]);
    const ADMIN = new Set(["admin","administrator","superadmin","super-admin","root"]);

    // check professionalId in params or query (for admin-targeted operations)
    const professionalId =
      (req.query && req.query.professionalId) ||
      (req.params && (req.params.professionalId || req.params.id));

    if (PROFESSIONAL.has(role)) return next();
    if ((ADMIN.has(role) || req.user.isAdmin === true) && professionalId) return next();

    return res.status(403).json({
      success: false,
      message:
        "Access denied: requires one of [professional, counsellor, counselor, therapist, mediator, lawyer] or admin with professionalId",
    });
  } catch (err) {
    console.error("requireProfessionalOrAdminForTarget middleware error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


export default {
  protect,
  adminOnly,
  requireRole,
  requireProfessionalOrAdminForTarget
};
