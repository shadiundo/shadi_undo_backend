// controllers/authController.js
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import { sendEmail } from "../utils/notify.js";
import { otpEmailHtml } from "../utils/emailTemplates.js";
import { normalizePhone } from "../utils/phone.js";
import UserProfile from "../models/UserProfile.js";
import Wallet from "../models/Wallet.js";


/* -------------------------- Safe user object -------------------------- */
const safeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  createdAt: user.createdAt,
});

/* -------------------------- Rate Limiter -------------------------- */
export const otpRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { message: "Too many OTP requests, try again later." },
});

/* -------------------------- HELPERS -------------------------- */
const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

/* -------------------------- CONFIG / THEME -------------------------- */
const siteName = process.env.SITE_NAME || "ShaadiUndo";
const themePrimary = process.env.THEME_PRIMARY || "#0f5860";
const themeAccent = process.env.THEME_ACCENT || "#ffd400";

/* ===================================================================== */
/* ========================= REGISTER (SEND OTP) ======================== */
/* ===================================================================== */
export const register = async (req, res) => {
  try {
    const { name, email, phone } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email required" });
    }

    const normEmail = email.toLowerCase().trim();

    const existing = await User.findOne({ email: normEmail });
    if (existing) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Create user WITHOUT OTP fields
    const user = await User.create({
      name,
      email: normEmail,
      phone,
      role: "user",
    });

    // Generate & store OTP (hashed inside User model)
    const otp = generateOtp();
    user.setOtp(otp);
    await user.save({ validateBeforeSave: false });

    const html = otpEmailHtml({
      name: user.name,
      otp,
      siteName,
      themePrimary,
      themeAccent,
    });

    await sendEmail({
      to: user.email,
      subject: `${siteName} - Verify your account`,
      html,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent to your email",
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ===================================================================== */
/* ====================== REGISTER VERIFY (OTP CHECK) =================== */
export const verifyRegister = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const normEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normEmail });

    if (!user || !user.verifyOtp(otp)) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.clearOtp();
    await user.save({ validateBeforeSave: false });

    // ✅ CREATE PROFILE (ONLY ONCE)
    await UserProfile.findOneAndUpdate(
      { user: user._id },
      {
        $setOnInsert: {
          user: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
        },
      },
      { upsert: true }
    );

    // ✅ CREATE WALLET
    await Wallet.getOrCreate(user._id);

    const token = user.getSignedJwtToken();

    return res.status(201).json({
      success: true,
      token,
      user: safeUser(user),
    });
  } catch (err) {
    console.error("verifyRegister error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
/* ======================== LOGIN REQUEST OTP =========================== */
export const loginRequestOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email required" });
    }

    const normEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normEmail });

    if (!user) {
      return res.status(404).json({ message: "No user found" });
    }

    if (user.role === "admin") {
      return res
        .status(403)
        .json({ message: "Admin must login with password" });
    }

    // ✅ Generate OTP
    const otp = generateOtp();
    user.setOtp(otp);
    await user.save({ validateBeforeSave: false });

    const html = otpEmailHtml({
      name: user.name,
      otp,
      siteName,
      themePrimary,
      themeAccent,
    });

    // ✅ TEMPORARY: send ONLY to your Resend account email
    await sendEmail({
      to: user.email, // 👈 PUT IT HERE
      subject: `${siteName} - Login OTP`,
      html,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent to your email",
    });
  } catch (err) {
    console.error("loginRequestOtp error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};



/* ===================================================================== */
/* ========================= LOGIN VERIFY OTP =========================== */
/* ===================================================================== */
export const loginVerifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP required" });
    }

    const normEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normEmail });

    if (!user || !user.verifyOtp(otp)) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    if (user.role === "admin") {
      return res
        .status(403)
        .json({ message: "Admin must login with password" });
    }

    user.clearOtp();
    await user.save({ validateBeforeSave: false });

    const token = user.getSignedJwtToken();

    return res.status(200).json({
      success: true,
      token,
      user: safeUser(user),
    });
  } catch (err) {
    console.error("loginVerifyOtp error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ===================================================================== */
/* =========================== ADMIN LOGIN ============================== */
/* ===================================================================== */
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const normEmail = email.toLowerCase().trim();
    const admin = await User.findOne({
      email: normEmail,
      role: "admin",
    }).select("+password");

    if (!admin) {
      return res.status(404).json({ message: "Admin user not found" });
    }

    const isMatch = await admin.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = admin.getSignedJwtToken();

    return res.status(200).json({
      success: true,
      token,
      user: safeUser(admin),
    });
  } catch (err) {
    console.error("adminLogin error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ===================================================================== */
/* ======================= GET ALL PROFESSIONALS ======================== */
/* ===================================================================== */
export const getAllProfessions = async (req, res) => {
  try {
    const professionals = await User.find({ role: "professional" }).select(
      "-password -otpHash -otpExpire"
    );

    return res.status(200).json({
      count: professionals.length,
      professionals,
    });
  } catch (err) {
    console.error("getAllProfessions error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/* ===================================================================== */
/* ========================= GET ALL CLIENTS ============================ */
/* ===================================================================== */
export const getAllClients = async (req, res) => {
  try {
    const clients = await User.find({ role: "user" }).select(
      "-password -otpHash -otpExpire"
    );

    return res.status(200).json({
      count: clients.length,
      clients,
    });
  } catch (err) {
    console.error("getAllClients error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
