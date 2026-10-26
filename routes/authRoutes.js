// routes/auth.js
import express from "express";
import {
  register,
  verifyRegister,
  loginRequestOtp,
  loginVerifyOtp,
  adminLogin,
  getAllProfessions,
  getAllClients,
  otpRateLimiter,
} from "../controllers/authController.js";

const router = express.Router();

// Registration: request OTP -> verify OTP
router.post("/register", otpRateLimiter, register);
router.post("/register/verify", verifyRegister);

// Login: OTP flow for non-admin users
router.post("/login", otpRateLimiter, loginRequestOtp);
router.post("/login/verify", loginVerifyOtp);

// Admin login (email + password)
router.post("/admin/login", adminLogin);

router.get("/professionals", getAllProfessions);
router.get("/clients", getAllClients);

export default router;
