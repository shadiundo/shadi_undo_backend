import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    email: { type: String, unique: true, sparse: true },

    phone: { type: String, unique: true, sparse: true },

    // Password REQUIRED only for admin login
    password: { type: String, select: false },

    role: {
      type: String,
      enum: ["user", "admin", "professional"],
      default: "user",
    },

    // ✅ OTP fields (HASHED)
    otpHash: { type: String },
    otpExpire: { type: Date },
  },
  { timestamps: true }
);

/* ---------------- PASSWORD HASHING (ADMIN ONLY) ---------------- */
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/* ---------------- PASSWORD MATCH ---------------- */
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

/* ---------------- OTP HELPERS ---------------- */
userSchema.methods.setOtp = function (otp) {
  this.otpHash = crypto.createHash("sha256").update(otp).digest("hex");
  this.otpExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
};

userSchema.methods.verifyOtp = function (otp) {
  if (!this.otpHash || !this.otpExpire) return false;
  if (this.otpExpire < Date.now()) return false;

  const hash = crypto.createHash("sha256").update(otp).digest("hex");
  return this.otpHash === hash;
};

userSchema.methods.clearOtp = function () {
  this.otpHash = undefined;
  this.otpExpire = undefined;
};

/* ---------------- JWT ---------------- */
userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign(
    { id: this._id, role: this.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "1d" }
  );
};

export default mongoose.model("User", userSchema);
