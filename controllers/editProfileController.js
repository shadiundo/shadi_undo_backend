import mongoose from "mongoose";
import Professional from "../models/Professional.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { resolveUserIdFromReq } from "../utils/getUserIdFromReq.js";
import { calculateProfileCompletion } from "../utils/profileCompletion.js";

/* ---------------- UPLOAD CONFIG ---------------- */
const uploadDir = path.resolve(process.cwd(), "uploads", "profiles");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

export const editProfileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ok =
      allowed.test(path.extname(file.originalname).toLowerCase()) &&
      allowed.test(file.mimetype);
    cb(null, ok);
  },
});

/* ---------------- HELPERS ---------------- */
const parseArray = (val) => {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === "string") {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr)) return arr.map((s) => String(s).trim()).filter(Boolean);
    } catch {}
    return val.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

const tryParseJSON = (val) => {
  if (val == null) return null;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(String(val));
  } catch {
    return null;
  }
};

/* ======================================================
   EDIT PROFILE CONTROLLER
====================================================== */
export const editProfile = async (req, res) => {
  try {
    const userId = await resolveUserIdFromReq(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const professional = await Professional.findById(userId);
    if (!professional) {
      return res.status(404).json({ success: false, message: "Professional not found" });
    }

    /* ======================================================
       LAWYER FIELD PROTECTION (MUST BE FIRST)
    ====================================================== */
    if (professional.role === "lawyer") {
      if (req.body.email !== undefined) delete req.body.email;
      if (req.body.enrollmentNumber !== undefined) delete req.body.enrollmentNumber;
    }

    const updateData = {};

    /* ---------------- PROFILE PHOTO ---------------- */
    if (req.file) {
      const basePublicUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      updateData.profilePhoto =
  `${basePublicUrl}/uploads/profiles/${encodeURIComponent(req.file.filename)}`
      ;
    }

    /* ---------------- BASIC INFO ---------------- */
    if (req.body.name !== undefined) updateData.name = req.body.name.trim();
    if (req.body.phone !== undefined) updateData.phone = req.body.phone.trim();
    if (req.body.overview !== undefined) updateData.overview = req.body.overview.trim();

    /* ---------------- LANGUAGES & SPECIALTIES ---------------- */
    if (req.body.languages !== undefined) updateData.languages = parseArray(req.body.languages);
    if (req.body.specialties !== undefined) updateData.specialties = parseArray(req.body.specialties);

    /* ---------------- LOCATION ---------------- */
    if (req.body.location !== undefined) {
      const locationData = tryParseJSON(req.body.location);
      if (locationData) {
        updateData.location = {
          country: locationData.country?.trim(),
          state: locationData.state?.trim(),
          city: locationData.city?.trim(),
          locality: locationData.locality?.trim(),
        };
      }
    }

    /* ---------------- EDUCATION ---------------- */
    if (req.body.education !== undefined) {
      const educationData = tryParseJSON(req.body.education);
      if (Array.isArray(educationData)) {
        updateData.education = educationData
          .map((edu) => ({
            degree: edu.degree?.trim(),
            institution: edu.institution?.trim(),
            year: Number(edu.year),
            fileUrl: edu.fileUrl?.trim(),
          }))
          .filter((edu) => edu.degree && edu.institution);
      }
    }

    /* ---------------- CERTIFICATES ---------------- */
    if (req.body.certificates !== undefined) {
      const certData = tryParseJSON(req.body.certificates);
      if (Array.isArray(certData)) {
        updateData.certificates = certData
          .map((cert) => ({
            title: cert.title?.trim(),
            issuedBy: cert.issuedBy?.trim(),
            year: Number(cert.year),
            fileUrl: cert.fileUrl?.trim(),
          }))
          .filter((cert) => cert.title && cert.issuedBy);
      }
    }

    /* ---------------- EXPERIENCE ---------------- */
    if (req.body.experience !== undefined) {
      const expData = tryParseJSON(req.body.experience);
      if (Array.isArray(expData)) {
        updateData.experience = expData
          .map((exp) => ({
            firm: exp.firm?.trim(),
            role: exp.role?.trim(),
            years: Number(exp.years),
            description: exp.description?.trim(),
          }))
          .filter((exp) => exp.firm && exp.role && !isNaN(exp.years));
      }
    }

    /* ---------------- AVAILABILITY ---------------- */
    if (req.body.availability !== undefined) {
      const availData = tryParseJSON(req.body.availability);
      if (Array.isArray(availData)) {
        updateData.availability = availData.filter((a) =>
          ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].includes(a.dayOfWeek)
        );
      }
    }

    /* ---------------- RATES ---------------- */
    if (req.body.rateOptions !== undefined) {
      const rateData = tryParseJSON(req.body.rateOptions);
      if (Array.isArray(rateData)) {
        updateData.rateOptions = rateData.filter(
          (r) => ["A","B","C","D","E"].includes(r.tier) && !isNaN(Number(r.ratePer30m))
        );
      }
    }

    if (req.body.defaultRate !== undefined) {
      updateData.defaultRate = Number(req.body.defaultRate);
      if (!isNaN(updateData.defaultRate)) {
        updateData.ratePerMinute = updateData.defaultRate / 30;
      }
    }

    if (req.body.yearsExperience !== undefined) {
      updateData.yearsExperience = Number(req.body.yearsExperience);
    }

    if (req.body.isInstantAvailable !== undefined) {
      updateData.isInstantAvailable = req.body.isInstantAvailable === true || req.body.isInstantAvailable === "true";
    }

    if (req.body.minInstantMinutes !== undefined) {
      updateData.minInstantMinutes = Math.max(5, Number(req.body.minInstantMinutes));
    }

    if (req.body.maxInstantMinutes !== undefined) {
      updateData.maxInstantMinutes = Math.max(
        updateData.minInstantMinutes || professional.minInstantMinutes || 30,
        Number(req.body.maxInstantMinutes)
      );
    }

    /* ======================================================
       PROFILE COMPLETION CALCULATION (CRITICAL)
    ====================================================== */
    const snapshot = { ...professional.toObject(), ...updateData };
    const completion = calculateProfileCompletion(snapshot);

    updateData.profileCompletion = completion;
    updateData.profileStage = completion >= 100 ? "completed" : "incomplete";
    updateData.updatedAt = Date.now();

    /* ---------------- SAVE ---------------- */
    const updatedProfessional = await Professional.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-password -resetPasswordToken -resetPasswordExpire");

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedProfessional,
    });

  } catch (error) {
    console.error("Edit profile error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error updating profile",
    });
  }
};
