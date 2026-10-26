// routes/userProfileRoutes.js
import express from "express";
import {
  getMyProfile,
  getMyAppointments,
  createOrUpdateProfile,
  updateMyProfile,
  deleteMyProfile,
  removeAppointment,
  updateAppointmentStatus,
  getProfileByUserId,
  signOut,
} from "../controllers/UserProfileController.js";

import auth, { protect, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// profile endpoints
router.get("/me", protect, getMyProfile);
router.get("/me/appointments", protect, getMyAppointments);

// profile CRUD
router.post("/me", protect, createOrUpdateProfile);
router.put("/me", protect, updateMyProfile);
router.delete("/me", protect, deleteMyProfile);

// NO booking endpoint here (users can't create bookings via profile)

// appointment management (pro/admin)
router.delete(
  "/me/appointments/:aptId",
  protect,
  requireRole("professional", "admin"),
  removeAppointment
);

router.put(
  "/:userId/appointments/:aptId/status",
  protect,
  requireRole("professional", "admin"),
  updateAppointmentStatus
);

// public profile by user id (owner or admin)
router.get("/:id", protect, getProfileByUserId);

// signout
router.post("/signout", protect, signOut);

export default router;
