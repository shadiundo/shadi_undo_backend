// controllers/professionalController.js
import mongoose from "mongoose";
import Professional from "../models/Professional.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { sendEmail } from "../utils/sendEmail.js";

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id));
const safeArray = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

// Allowed rate option tiers
const ALLOWED_TIERS = ["A", "B", "C", "D", "E"];

function normalizeRateOptions(input) {
  if (!Array.isArray(input)) return [];

  const seen = new Set();
  const mapped = [];

  for (const item of input) {
    if (!item) continue;
    let tier = (item.tier || "").toString().trim().toUpperCase();
    if (!ALLOWED_TIERS.includes(tier)) continue;
    if (seen.has(tier)) continue;

    let ratePer30m = item.ratePer30m != null ? Number(item.ratePer30m) : null;
    if (Number.isNaN(ratePer30m) || ratePer30m <= 0) continue;

    const description = item.description ? String(item.description).trim() : "";

    seen.add(tier);
    mapped.push({ tier, ratePer30m, description });
  }

  mapped.sort((a, b) => ALLOWED_TIERS.indexOf(a.tier) - ALLOWED_TIERS.indexOf(b.tier));
  return mapped.slice(0, 4);
}

/* ---------- Availability normalization helpers ---------- */
const ALLOWED_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function normalizeWeekdayName(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  const map = {
    mon: "Monday", monday: "Monday",
    tue: "Tuesday", tues: "Tuesday", tuesday: "Tuesday",
    wed: "Wednesday", wednesday: "Wednesday",
    thu: "Thursday", thursday: "Thursday",
    fri: "Friday", friday: "Friday",
    sat: "Saturday", saturday: "Saturday",
    sun: "Sunday", sunday: "Sunday"
  };
  // try exact map first (handles 'monday', 'mon', etc.)
  if (map[s]) return map[s];
  // fallback: take first 3 letters
  const key3 = s.slice(0, 3);
  return map[key3] || null;
}

function isValidTimeString(t) {
  if (!t || typeof t !== "string") return false;
  if (!/^\d{1,2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function parseTimeToMinutesSafe(t) {
  if (!isValidTimeString(t)) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function padTime(t) {
  const [h, m] = String(t).split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * normalizeAvailability(input)
 * - input: array of { dayOfWeek, slots: [{ startTime, endTime, mode }] }
 * - returns cleaned array: [{ dayOfWeek: "Monday", slots: [{ startTime:"10:00", endTime:"14:00", mode:"video" }, ...] }, ...]
 * - merges duplicate days, sorts slots, removes malformed slots and overlaps (keeps first non-overlapping slots)
 */
function normalizeAvailability(input) {
  if (!Array.isArray(input)) return [];

  const outMap = new Map();

  for (const block of input) {
    if (!block) continue;
    const rawDay = block.dayOfWeek || block.day || block.weekday;
    const dayName = normalizeWeekdayName(rawDay);
    if (!dayName) continue;

    const rawSlots = Array.isArray(block.slots) ? block.slots : [];
    for (const s of rawSlots) {
      if (!s) continue;
      const startRaw = (s.startTime || s.start || "").toString().trim();
      const endRaw = (s.endTime || s.end || "").toString().trim();
      const modeRaw = (s.mode || "audio").toString().toLowerCase();

      if (!isValidTimeString(startRaw) || !isValidTimeString(endRaw)) continue;
      const sMin = parseTimeToMinutesSafe(startRaw);
      const eMin = parseTimeToMinutesSafe(endRaw);
      if (sMin == null || eMin == null || eMin <= sMin) continue;

      const slot = {
        startTime: padTime(startRaw),
        endTime: padTime(endRaw),
        mode: modeRaw === "video" ? "video" : "audio",
      };

      if (!outMap.has(dayName)) outMap.set(dayName, []);
      outMap.get(dayName).push({ ...slot, __sMin: sMin, __eMin: eMin });
    }
  }

  // Convert map to array, sort and remove overlaps
  const merged = [];
  for (const day of ALLOWED_WEEKDAYS) {
    const slots = outMap.get(day) || [];
    if (!slots.length) continue;

    // sort by start
    slots.sort((a, b) => a.__sMin - b.__sMin);

    // remove overlaps (keep first)
    const cleaned = [];
    for (const s of slots) {
      let overlap = false;
      for (const c of cleaned) {
        if (Math.max(s.__sMin, c.__sMin) < Math.min(s.__eMin, c.__eMin)) {
          overlap = true;
          break;
        }
      }
      if (!overlap) cleaned.push(s);
    }

    // strip helper fields and push
    merged.push({
      dayOfWeek: day,
      slots: cleaned.map((s) => ({ startTime: s.startTime, endTime: s.endTime, mode: s.mode })),
    });
  }

  return merged;
}


/** Register Professional */

export const registerProfessional = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    /* ---------------- BASIC REQUIRED CHECK ---------------- */
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "name, email, password and role are required",
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const exists = await Professional.findOne({ email: normalizedEmail });
    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const isLawyer = role === "lawyer";

    /* ======================================================
       LAWYER-SPECIFIC REQUIRED VALIDATION
    ====================================================== */
    if (isLawyer && !req.body.enrollmentNumber) {
      return res.status(400).json({
        success: false,
        message: "Enrollment number is required for lawyers",
      });
    }

    /* ---------------- NORMALIZE COMMON FIELDS ---------------- */

    const specialties = Array.isArray(req.body.specialties)
      ? req.body.specialties.map((s) => String(s).trim())
      : typeof req.body.specialties === "string"
        ? req.body.specialties.split(",").map((s) => s.trim())
        : [];

    /* ---------------- EDUCATION (NON-LAWYER FULL FLOW) ---------------- */
    const education = safeArray(req.body.education).map((e) => ({
      degree: e?.degree || "",
      institution: e?.institution || "",
      year: e?.year || null,
      fileUrl: e?.fileUrl || "",
    }));

    /* ---------------- EXPERIENCE ---------------- */
    const experience = safeArray(req.body.experience).map((e) => ({
      firm: e?.firm || e?.clinic || "",
      role: e?.role || "",
      years: e?.years || null,
      description: e?.description || "",
    }));

    /* ---------------- CERTIFICATES ---------------- */
    const certificates = safeArray(req.body.certificates).map((c) => ({
      title: c?.title || "",
      issuedBy: c?.issuedBy || "",
      year: c?.year || null,
      fileUrl: c?.fileUrl || "",
    }));

    /* ---------------- DOCUMENTS ---------------- */
    const LAWYER_DOC_TYPES = [
      "bar_council_id",
      "enrollment_certificate",
      "certificate_of_practice",
    ];

    let documents = safeArray(req.body.documents).map((d) => ({
      type: d?.type || "",
      fileUrl: d?.fileUrl || "",
    }));

    if (isLawyer) {
      documents = documents.filter((d) =>
        LAWYER_DOC_TYPES.includes(d.type)
      );

      if (documents.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "At least one lawyer verification document is required",
        });
      }
    }

    /* ---------------- ADDITIONAL DOCUMENTS (STRUCTURED) ---------------- */
    const ALLOWED_ID_DOCS = [
      "aadhaar",
      "voter_id",
      "driving_licence",
    ];

    const additionalDocuments = safeArray(req.body.additionalDocuments)
      .map((a) => ({
        title: (a?.title || "").toLowerCase(),
        description: a?.description || "",
        fileUrl: a?.fileUrl || "",
        assignedBy: a?.assignedBy || undefined,
        assignedAt: a?.assignedAt || undefined,
      }))
      .filter((a) => ALLOWED_ID_DOCS.includes(a.title));

    /* ---------------- COMPUTE YEARS EXPERIENCE ---------------- */
    let yearsExperience = 0;
    if (typeof req.body.yearsExperience === "number") {
      yearsExperience = Number(req.body.yearsExperience);
    } else if (Array.isArray(req.body.experience)) {
      const yrs = req.body.experience
        .map((e) => Number(e?.years || 0))
        .filter((n) => !Number.isNaN(n));
      if (yrs.length > 0) yearsExperience = Math.max(...yrs);
    }

    /* ---------------- RATES (NON-LAWYER FULL FLOW) ---------------- */
    const rateOptions = normalizeRateOptions(req.body.rateOptions || []);
    const explicitDefault =
      req.body.defaultRate != null ? Number(req.body.defaultRate) : null;
    const fallbackDefault =
      rateOptions.length > 0 && Number(rateOptions[0].ratePer30m) > 0
        ? Number(rateOptions[0].ratePer30m)
        : 2000;
    const defaultRate =
      explicitDefault && explicitDefault > 0
        ? explicitDefault
        : fallbackDefault;
    const ratePerMinute = Number((defaultRate / 30).toFixed(6));

    /* ---------------- INSTANT BOOKING ---------------- */
    let isInstantAvailable = !!req.body.isInstantAvailable;
    let minInstantMinutes = Number(req.body.minInstantMinutes || 30);
    let maxInstantMinutes = Number(req.body.maxInstantMinutes || 120);
    if (Number.isNaN(minInstantMinutes) || minInstantMinutes < 5)
      minInstantMinutes = 5;
    if (Number.isNaN(maxInstantMinutes) || maxInstantMinutes < minInstantMinutes)
      maxInstantMinutes = Math.max(minInstantMinutes, 60);

    /* ---------------- AVAILABILITY ---------------- */
    const availability = normalizeAvailability(
      req.body.availability || req.body.schedule || []
    );

    /* ======================================================
       BUILD PROFESSIONAL OBJECT
       (LAWYER = MINIMAL, OTHERS = FULL)
    ====================================================== */
    const profObj = {
      name: String(name).trim(),
      email: normalizedEmail,
      phone: req.body.phone || "",
      password,
      role,

      specialties,
      location: req.body.location || {},

      documents,
      additionalDocuments,

      enrollmentNumber: isLawyer
        ? String(req.body.enrollmentNumber).trim()
        : undefined,

      /* ---- NON-LAWYER FIELDS (LAWYER FILLS LATER) ---- */
      overview: isLawyer ? "" : req.body.overview || "",
      languages: isLawyer
        ? []
        : Array.isArray(req.body.languages)
          ? req.body.languages.map((l) =>
            typeof l === "string" ? l : l?.value || l?.label
          )
          : [],
      education: isLawyer ? [] : education,
      experience: isLawyer ? [] : experience,
      certificates: isLawyer ? [] : certificates,
      yearsExperience: isLawyer ? 0 : yearsExperience,
      rateOptions: isLawyer ? [] : rateOptions,
      defaultRate: isLawyer ? 0 : defaultRate,
      ratePerMinute: isLawyer ? 0 : ratePerMinute,
      isInstantAvailable: isLawyer ? false : isInstantAvailable,
      minInstantMinutes: isLawyer ? 30 : minInstantMinutes,
      maxInstantMinutes: isLawyer ? 120 : maxInstantMinutes,
      availability: isLawyer ? [] : availability,

      profileStage: "incomplete",
      profileCompletion: isLawyer ? 30 : 40,

      status: "pending",
    };

    /* ---------------- SAVE ---------------- */
    const professional = new Professional(profObj);
    await professional.save();

    /* ---------------- TOKEN ---------------- */
    const token =
      typeof professional.getSignedJwtToken === "function"
        ? professional.getSignedJwtToken()
        : jwt.sign(
          { id: professional._id, role: professional.role },
          process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );

    /* ---------------- EMAILS (ASYNC) ---------------- */
    setImmediate(async () => {
      try {
        await sendEmail({
          email: professional.email,
          subject: "Registration Received — Shaadi Undo",
          html: `<div style="font-family:Arial,sans-serif;color:#333">
            <h3>Welcome, ${professional.name}!</h3>
            <p>Thank you for registering as a <strong>${professional.role}</strong>.</p>
            <p>Complete your profile to start receiving clients.</p>
            <p>Warm regards,<br/><strong>Shaadi Undo Team</strong></p>
          </div>`,
        });
      } catch (err) {
        console.error("[MAIL] User mail failed:", err?.message || err);
      }

      try {
        const adminEmail =
          process.env.ADMIN_EMAIL || process.env.SMTP_USER;
        if (adminEmail) {
          await sendEmail({
            email: adminEmail,
            subject: `New Professional Registered — ${professional.name}`,
            html: `<div>
              <p><strong>Name:</strong> ${professional.name}</p>
              <p><strong>Email:</strong> ${professional.email}</p>
              <p><strong>Role:</strong> ${professional.role}</p>
            </div>`,
          });
        }
      } catch (err) {
        console.error("[MAIL] Admin mail failed:", err?.message || err);
      }
    });

    /* ---------------- RESPONSE ---------------- */
    const profSafe = professional.toObject();
    delete profSafe.password;

    return res.status(201).json({
      success: true,
      message:
        "Registered successfully! Please complete your profile.",
      professional: profSafe,
      token,
    });
  } catch (error) {
    console.error("registerProfessional error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};



export const loginProfessional = async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) return res.status(400).json({ success: false, message: "Please provide email and password" });

    const professional = await Professional.findOne({ email: String(email).toLowerCase() }).select("+password");
    if (!professional) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, professional.password);
    if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const token = professional.getSignedJwtToken();
    const profObj = professional.toObject();
    delete profObj.password;
    res.status(200).json({ success: true, professional: profObj, token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const professional = await Professional.findOne({ email: String(email).toLowerCase() });
    if (!professional) {
      // Do not reveal whether email exists; respond success for security
      return res.status(200).json({ success: true, message: "If an account exists, a password reset link will be sent to the associated email." });
    }

    const resetToken = crypto.randomBytes(20).toString("hex");
    professional.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    professional.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
    await professional.save({ validateBeforeSave: false });

    // send email with reset link (plain token in link)
    try {
      const base = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      const resetUrl = `${base}/api/professionals/reset-password/${resetToken}`;
      await sendEmail({
        email: professional.email,
        subject: "Password reset request — Shaadi Undo",
        html: `<div style="font-family:Arial,sans-serif;color:#333">
          <p>Hi ${professional.name || "there"},</p>
          <p>You requested a password reset. Click the link below to reset your password (valid for 10 minutes):</p>
          <p><a href="${resetUrl}">${resetUrl}</a></p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>`,
      });
      console.log(`[MAIL] Password reset email sent to ${professional.email}`);
    } catch (mailErr) {
      console.error("[MAIL] Password reset email failed:", mailErr && mailErr.message ? mailErr.message : mailErr);
    }

    // don't return token in response
    return res.status(200).json({ success: true, message: "If an account exists, a password reset link will be sent to the associated email." });
  } catch (err) {
    console.error("forgotPassword error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const resetPasswordToken = crypto.createHash("sha256").update(req.params.token).digest("hex");

    const professional = await Professional.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!professional) return res.status(400).json({ success: false, message: "Invalid or expired token" });

    professional.password = req.body.password;
    professional.resetPasswordToken = undefined;
    professional.resetPasswordExpire = undefined;
    await professional.save();

    const token = professional.getSignedJwtToken();
    res.status(200).json({ success: true, token });
  } catch (err) {
    console.error("resetPassword error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const verifyPasswordForEmail = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "admin") return res.status(403).json({ success: false, message: "Admin only" });

    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Provide email and password in body" });

    const professional = await Professional.findOne({ email: String(email).toLowerCase() }).select("+password");
    if (!professional) return res.status(404).json({ success: false, message: "Professional not found" });

    const isMatch = await bcrypt.compare(password, professional.password);
    return res.status(200).json({ success: true, email: professional.email, match: isMatch });
  } catch (err) {
    console.error("verifyPasswordForEmail error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const searchProfessionals = async (req, res) => {
  try {
    const { role, id, email, q, page = 1, limit = 25, sortBy = "createdAt", sortDir = "desc", password } = req.query;

    if (password) {
      return res.status(400).json({ success: false, message: "Password scanning is disallowed. Use admin verifyPasswordForEmail endpoint with email+password in body." });
    }

    const query = {};
    if (role) query.role = String(role).toLowerCase();
    if (id) {
      if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id parameter" });
      query._id = id;
    }
    if (email) query.email = String(email).toLowerCase();
    if (q) {
      const regex = new RegExp(q, "i");
      query.$or = [{ name: regex }, { email: regex }, { role: regex }, { specialties: regex }];
    }
    // query.status = "approved";
    // query.profileCompletion = { $gte: 70 };

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(parseInt(limit, 10) || 25, 100);
    const skip = (pageNum - 1) * lim;
    const sort = { [sortBy]: sortDir === "asc" ? 1 : -1 };

    const [total, professionals] = await Promise.all([Professional.countDocuments(query), Professional.find(query).sort(sort).skip(skip).limit(lim)]);

    if (!professionals || professionals.length === 0) return res.status(404).json({ success: false, message: "No professionals found" });

    res.status(200).json({
      success: true,
      meta: { total, page: pageNum, limit: lim, pages: Math.ceil(total / lim) },
      data: professionals,
    });
  } catch (error) {
    console.error("searchProfessionals error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getProfessionalsByRole = async (req, res) => {
  try {
    const { role } = req.params;
    const professionals = await Professional.find({ role });
    res.json({ success: true, data: professionals });
  } catch (err) {
    console.error("getProfessionalsByRole error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAllProfessionals = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(parseInt(limit, 10) || 100, 500);
    const skip = (pageNum - 1) * lim;

    const [total, professionals] = await Promise.all([Professional.countDocuments(), Professional.find().sort({ createdAt: -1 }).skip(skip).limit(lim)]);

    res.json({ success: true, meta: { total, page: pageNum, limit: lim, pages: Math.ceil(total / lim) }, professionals });
  } catch (err) {
    console.error("getAllProfessionals error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getProfessionalById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const professional = await Professional.findById(id);
    if (!professional) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, professional });
  } catch (err) {
    console.error("getProfessionalById error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateProfessional = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const professional = await Professional.findById(id);
    if (!professional) return res.status(404).json({ success: false, message: "Not found" });

    if (req.user && req.user.role !== "admin" && req.user.email !== professional.email) {
      return res.status(403).json({ success: false, message: "Not authorized to update" });
    }

    if (req.body.yearsExperience != null) {
      const y = Number(req.body.yearsExperience) || 0;
      professional.yearsExperience = y;
    }

    if (req.body.rateOptions != null) {
      const normalized = normalizeRateOptions(req.body.rateOptions);
      professional.rateOptions = normalized.length > 0 ? normalized : [];
    }

    if (req.body.defaultRate != null) {
      const dr = Number(req.body.defaultRate);
      if (!Number.isNaN(dr) && dr > 0) professional.defaultRate = dr;
    } else {
      if ((!professional.defaultRate || professional.defaultRate <= 0) && Array.isArray(professional.rateOptions) && professional.rateOptions.length > 0) {
        professional.defaultRate = Number(professional.rateOptions[0].ratePer30m);
      }
    }

    if (req.body.ratePer30m != null) {
      const rp = Number(req.body.ratePer30m);
      if (!Number.isNaN(rp) && rp > 0) professional.defaultRate = rp;
    }

    if (professional.defaultRate != null && !Number.isNaN(Number(professional.defaultRate))) {
      professional.ratePerMinute = Number((Number(professional.defaultRate) / 30).toFixed(6));
    }

    if (req.body.isInstantAvailable != null) professional.isInstantAvailable = Boolean(req.body.isInstantAvailable);

    if (req.body.minInstantMinutes != null) {
      const minM = Number(req.body.minInstantMinutes);
      professional.minInstantMinutes = Number.isNaN(minM) ? professional.minInstantMinutes : Math.max(5, minM);
      if (professional.maxInstantMinutes != null && professional.maxInstantMinutes < professional.minInstantMinutes) {
        professional.maxInstantMinutes = professional.minInstantMinutes;
      }
    }

    if (req.body.maxInstantMinutes != null) {
      const maxM = Number(req.body.maxInstantMinutes);
      professional.maxInstantMinutes = Number.isNaN(maxM) ? professional.maxInstantMinutes : Math.max(maxM, professional.minInstantMinutes || 5);
    }

    const updatable = { ...req.body };
    delete updatable.password;
    delete updatable.email;
    delete updatable.rateOptions;
    delete updatable.defaultRate;
    delete updatable.ratePer30m;
    delete updatable.ratePerMinute;
    delete updatable.minInstantMinutes;
    delete updatable.maxInstantMinutes;
    delete updatable.isInstantAvailable;
    delete updatable.yearsExperience;

    Object.assign(professional, updatable);
    await professional.save();

    const profObj = professional.toObject();
    delete profObj.password;
    res.json({ success: true, professional: profObj });
  } catch (err) {
    console.error("updateProfessional error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteProfessional = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    if (!req.user || req.user.role !== "admin") return res.status(403).json({ success: false, message: "Admin only" });

    await Professional.findByIdAndDelete(id);
    res.json({ success: true, message: "Professional deleted" });
  } catch (err) {
    console.error("deleteProfessional error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const approveProfessional = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const update = { status: "approved", reviewedAt: new Date() };
    if (req.user && req.user._id) update.reviewedBy = req.user._id;

    const professional = await Professional.findByIdAndUpdate(id, update, { new: true });
    if (!professional) return res.status(404).json({ success: false, message: "Professional not found" });

    (async () => {
      try {
        await sendEmail({
          email: professional.email,
          subject: "Your profile has been approved — Shaadi Undo",
          html: `<div style="font-family: Arial, sans-serif; color:#222;">
                  <h3>Hi ${professional.name},</h3>
                  <p>Your profile has been <strong>approved</strong> by our team. You can now log in and use your account.</p>
                  <p>Regards,<br/>Shaadi Undo Team</p>
                 </div>`,
        });
        console.log(`[mail] Approval email sent to ${professional.email}`);
      } catch (mailErr) {
        console.warn("[mail] Approval email failed:", mailErr && mailErr.message ? mailErr.message : mailErr);
      }
    })();

    res.json({ success: true, professional });
  } catch (err) {
    console.error("approveProfessional error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const rejectProfessional = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { reason } = req.body;

    const update = { status: "rejected", rejectionReason: reason || "", reviewedAt: new Date() };
    if (req.user && req.user._id) update.reviewedBy = req.user._id;

    const professional = await Professional.findByIdAndUpdate(id, update, { new: true });
    if (!professional) return res.status(404).json({ success: false, message: "Professional not found" });

    (async () => {
      try {
        const reasonText = reason ? `<p><strong>Reason:</strong> ${reason}</p>` : "";
        await sendEmail({
          email: professional.email,
          subject: "Your profile has been rejected — Shaadi Undo",
          html: `<div style="font-family: Arial, sans-serif; color:#222;">
                  <h3>Hi ${professional.name},</h3>
                  <p>Your profile has been reviewed and <strong>rejected</strong> by our team.</p>
                  ${reasonText}
                  <p>Please update your profile or provide requested documents and re-submit for review.</p>
                  <p>Regards,<br/>Shaadi Undo Team</p>
                 </div>`,
        });
        console.log(`[mail] Rejection email sent to ${professional.email}`);
      } catch (mailErr) {
        console.warn("[mail] Rejection email failed:", mailErr && mailErr.message ? mailErr.message : mailErr);
      }
    })();

    res.json({ success: true, professional });
  } catch (err) {
    console.error("rejectProfessional error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getProfessionStats = async (req, res) => {
  try {
    const totalProfessionals = await Professional.countDocuments();
    const lawyers = await Professional.countDocuments({ role: "lawyer" });
    const mediators = await Professional.countDocuments({ role: "mediator" });
    const therapists = await Professional.countDocuments({ role: "therapist" });
    const counsellors = await Professional.countDocuments({ role: "counsellor" });

    res.status(200).json({ totalProfessionals, lawyers, mediators, therapists, counsellors });
  } catch (error) {
    console.error("Error fetching profession stats:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getCurrentProfessional = async (req, res) => {
  try {
    if (req.user && (req.user._id || req.user.id)) {
      const idFromReqUser = String(req.user._id ?? req.user.id);
      if (isValidObjectId(idFromReqUser)) {
        const prof = await Professional.findById(idFromReqUser).select("-password");
        if (!prof) return res.status(404).json({ success: false, message: "Professional not found" });
        return res.status(200).json({ success: true, professional: prof });
      }
    }

    const rawAuth = (req.headers.authorization || req.headers["x-auth-token"] || "").toString();
    const cookieToken = req.cookies?.token ? String(req.cookies.token) : "";
    let token = null;
    if (rawAuth) token = rawAuth.startsWith("Bearer ") ? rawAuth.split(" ")[1] : rawAuth;
    else if (cookieToken) token = cookieToken;

    if (!token) return res.status(401).json({ success: false, message: "Not authorized (no token provided)" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (verifyErr) {
      console.error("[/me] jwt.verify error:", verifyErr && verifyErr.message ? verifyErr.message : verifyErr);
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
        hint: process.env.NODE_ENV === "development" ? { verifyError: verifyErr && verifyErr.message } : undefined,
      });
    }

    const possible = ["id", "_id", "userId", "sub", "profId", "professionalId", "uid"];
    let candidateIdRaw = null;
    for (const k of possible) {
      if (decoded && Object.prototype.hasOwnProperty.call(decoded, k) && decoded[k] != null) {
        candidateIdRaw = decoded[k];
        break;
      }
    }
    const candidateId = candidateIdRaw ? String(candidateIdRaw) : "";

    if (!candidateId) {
      return res.status(400).json({
        success: false,
        message: "Invalid id (no id claim in token)",
        hint: process.env.NODE_ENV === "development" ? { decoded, candidateIdRaw } : undefined,
      });
    }

    try {
      const professional = await Professional.findById(candidateId).select("-password");
      if (!professional) return res.status(404).json({ success: false, message: "Professional not found" });
      return res.status(200).json({ success: true, professional });
    } catch (dbErr) {
      console.error("[/me] DB error finding by id:", candidateId, dbErr && dbErr.message ? dbErr.message : dbErr);
      return res.status(400).json({
        success: false,
        message: "Invalid id (DB/cast error)",
        hint: process.env.NODE_ENV === "development" ? { error: dbErr && dbErr.message, decoded, candidateId } : undefined,
      });
    }
  } catch (err) {
    console.error("getCurrentProfessional unexpected error:", err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ---------- availability helpers used by routes ----------
const parseTimeToMinutes = (t) => {
  if (!t || typeof t !== "string") return null;
  const parts = t.split(":").map((s) => parseInt(s, 10));
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  const h = Math.max(0, Math.min(23, parts[0]));
  const m = Math.max(0, Math.min(59, parts[1]));
  return h * 60 + m;
};

const formatMinutesToTime = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${hh}:${mm}`;
};

const slotsOverlap = (startA, endA, startB, endB) => {
  return Math.max(startA, startB) < Math.min(endA, endB);
};

const normalizeWeekday = (raw) => {
  if (!raw) return null;
  const map = {
    mon: "Monday",
    monday: "Monday",
    tue: "Tuesday",
    tues: "Tuesday",
    tuesday: "Tuesday",
    wed: "Wednesday",
    wednesday: "Wednesday",
    thu: "Thursday",
    thursday: "Thursday",
    fri: "Friday",
    friday: "Friday",
    sat: "Saturday",
    saturday: "Saturday",
    sun: "Sunday",
    sunday: "Sunday",
  };
  const key = String(raw).trim().toLowerCase().slice(0, 3);
  return map[key] || (map[String(raw).trim().toLowerCase()] || null);
};

export const addAvailabilitySlot = async (req, res) => {
  try {
    const professionalId = req.user && (req.user._id ?? req.user.id);
    if (!professionalId) return res.status(401).json({ success: false, message: "Auth required" });

    const { weekday } = req.params;
    const { startTime, endTime, mode = "audio" } = req.body;
    const day = normalizeWeekday(weekday);
    if (!day) return res.status(400).json({ success: false, message: "Invalid weekday" });

    const sMin = parseTimeToMinutes(startTime);
    const eMin = parseTimeToMinutes(endTime);
    if (sMin == null || eMin == null || eMin <= sMin) {
      return res.status(400).json({ success: false, message: "Invalid startTime/endTime" });
    }

    const prof = await Professional.findById(professionalId);
    if (!prof) return res.status(404).json({ success: false, message: "Professional not found" });

    prof.availability = prof.availability || [];
    let dayEntry = prof.availability.find((d) => d.dayOfWeek === day);
    if (!dayEntry) {
      dayEntry = { dayOfWeek: day, slots: [] };
      prof.availability.push(dayEntry);
    }

    for (const slot of dayEntry.slots || []) {
      const a = parseTimeToMinutes(slot.startTime);
      const b = parseTimeToMinutes(slot.endTime);
      if (a == null || b == null) {
        console.warn("[availability] skipping malformed slot", slot);
        continue;
      }
      if (slotsOverlap(sMin, eMin, a, b)) {
        return res.status(400).json({ success: false, message: "Slot overlaps existing availability" });
      }
    }

    dayEntry.slots.push({
      startTime: formatMinutesToTime(sMin),
      endTime: formatMinutesToTime(eMin),
      mode: ["audio", "video"].includes(mode) ? mode : "audio",
    });

    // keep slots sorted by startTime
    dayEntry.slots.sort((x, y) => parseTimeToMinutes(x.startTime) - parseTimeToMinutes(y.startTime));

    // NOTE: concurrent addAvailabilitySlot requests may still cause race condition overlaps.
    // Consider using optimistic concurrency or DB-level checks if this matters.

    await prof.save();
    return res.json({ success: true, availability: prof.availability });
  } catch (err) {
    console.error("addAvailabilitySlot error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const removeAvailabilitySlot = async (req, res) => {
  try {
    const professionalId = req.user && (req.user._id ?? req.user.id);
    if (!professionalId) return res.status(401).json({ success: false, message: "Auth required" });

    const { weekday, slotIndex } = req.params;
    const day = normalizeWeekday(weekday);
    if (!day) return res.status(400).json({ success: false, message: "Invalid weekday" });

    const prof = await Professional.findById(professionalId);
    if (!prof) return res.status(404).json({ success: false, message: "Professional not found" });

    const dayEntry = (prof.availability || []).find((d) => d.dayOfWeek === day);
    if (!dayEntry) return res.status(404).json({ success: false, message: "No availability for that day" });

    const idx = parseInt(slotIndex, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= dayEntry.slots.length) {
      return res.status(400).json({ success: false, message: "Invalid slot index" });
    }

    dayEntry.slots.splice(idx, 1);
    if (!dayEntry.slots.length) {
      prof.availability = prof.availability.filter((d) => d.dayOfWeek !== day);
    }

    await prof.save();
    return res.json({ success: true, availability: prof.availability });
  } catch (err) {
    console.error("removeAvailabilitySlot error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getAvailableSlots = async (req, res) => {
  try {
    const { id } = req.params;
    const { from, to, duration = 30, step = 30, maxDays = 31 } = req.query;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid professional id" });

    const fromDate = from ? new Date(from) : new Date();
    const toDate = to ? new Date(to) : new Date(Date.now() + 7 * 24 * 3600 * 1000);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || toDate < fromDate) {
      return res.status(400).json({ success: false, message: "Invalid from/to dates" });
    }

    const dayDiff = Math.ceil((toDate - fromDate) / (24 * 3600 * 1000));
    const maxDaysNum = Math.min(Math.max(Number(maxDays) || 31, 1), 365);
    if (dayDiff > maxDaysNum) return res.status(400).json({ success: false, message: `Range too large (max ${maxDaysNum} days)` });

    const prof = await Professional.findById(id).lean();
    if (!prof) return res.status(404).json({ success: false, message: "Professional not found" });

    const daysMap = (prof.availability || []).reduce((acc, d) => {
      acc[d.dayOfWeek] = d.slots || [];
      return acc;
    }, {});

    const results = [];
    const dur = Math.max(1, Number(duration) || 30);
    const stepMin = Math.max(1, Number(step) || dur);

    for (let dt = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()); dt <= toDate; dt.setDate(dt.getDate() + 1)) {
      const weekday = dt.toLocaleDateString("en-US", { weekday: "long" });
      const slotsForDay = daysMap[weekday] || [];
      for (const slot of slotsForDay) {
        const startMin = parseTimeToMinutes(slot.startTime);
        const endMin = parseTimeToMinutes(slot.endTime);
        if (startMin == null || endMin == null) continue;

        for (let start = startMin; start + dur <= endMin; start += stepMin) {
          const slotStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), Math.floor(start / 60), start % 60, 0);
          const slotEnd = new Date(slotStart.getTime() + dur * 60 * 1000);
          results.push({
            startUtc: slotStart.toISOString(),
            endUtc: slotEnd.toISOString(),
            weekday,
            mode: slot.mode || "audio",
            displayLocal: `${slotStart.toLocaleString()} - ${slotEnd.toLocaleTimeString()}`,
          });
        }
      }
    }

    return res.json({ success: true, slots: results });
  } catch (err) {
    console.error("getAvailableSlots error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export default {
  registerProfessional,
  loginProfessional,
  forgotPassword,
  resetPassword,
  verifyPasswordForEmail,
  searchProfessionals,
  getProfessionalsByRole,
  getAllProfessionals,
  getProfessionalById,
  updateProfessional,
  deleteProfessional,
  approveProfessional,
  rejectProfessional,
  getProfessionStats,
  getCurrentProfessional,
  addAvailabilitySlot,
  removeAvailabilitySlot,
  getAvailableSlots,
};
