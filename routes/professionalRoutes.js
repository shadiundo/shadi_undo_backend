import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { editProfileUpload, editProfile } from "../controllers/editProfileController.js";
import { upload } from "../middleware/uploadMiddleware.js";
import {
  registerProfessional,
  loginProfessional,
  forgotPassword,
  resetPassword,
  getProfessionalsByRole,
  getAllProfessionals,
  getProfessionalById,
  updateProfessional,
  deleteProfessional,
  approveProfessional,
  rejectProfessional,
  searchProfessionals,
  getProfessionStats,
  getCurrentProfessional,
  addAvailabilitySlot,
  removeAvailabilitySlot,
  getAvailableSlots,
} from "../controllers/professionalController.js";
import { sendEmail } from "../utils/sendEmail.js";
import authMiddleware, { protect, adminOnly } from "../middleware/authMiddleware.js";
import Professional from "../models/Professional.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDirCandidates = [
  path.join(process.cwd(), "uploads"),
  path.join(__dirname, "../uploads"),
];
const uploadsDir = uploadsDirCandidates.find((p) => fs.existsSync(p)) || path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}


router.put(
  "/edit-profile",
  protect,
  editProfileUpload.single("profilePhoto"),
  editProfile
);

router.post("/upload-public", upload.any(), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const file = req.files[0];
    const basePublicUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${basePublicUrl}/api/professionals/files/${encodeURIComponent(file.filename)}`;
    console.log("[UPLOAD_PUBLIC] saved:", file.path);
    return res.json({
      success: true,
      fileUrl,
      filename: file.filename,
      relativePath: `/uploads/${file.filename}`,
      message: "Uploaded (public)",
    });
  } catch (err) {
    console.error("[UPLOAD_PUBLIC] error:", err);
    return res.status(500).json({ success: false, message: err.message || "Upload error" });
  }
});

router.post("/upload", protect, upload.any(), async (req, res) => {
  try {
    console.log("[UPLOAD] start", { userId: req.user?._id, userType: req.userType, role: req.user?.role });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const file = req.files[0];
    const filename = file.filename;
    const basePublicUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${basePublicUrl}/api/professionals/files/${encodeURIComponent(filename)}`;
    const { title, description, professionalId: requestedProfessionalId } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: "title is required for additional documents" });
    }
    let targetProfessionalId = null;
    if (req.userType === "Professional") {
      targetProfessionalId = req.user._id;
    } else if (req.user && req.user.role === "admin") {
      if (!requestedProfessionalId) {
        return res.status(400).json({ success: false, message: "admin requests must include professionalId" });
      }
      targetProfessionalId = requestedProfessionalId;
    } else {
      return res.status(403).json({ success: false, message: "Only the professional owner or admins can upload and attach additional documents." });
    }
    console.log("[UPLOAD] targetProfessionalId:", targetProfessionalId);
    const docEntry = {
      title: title.trim(),
      description: (description && description.trim()) || "",
      fileUrl,
      assignedBy: req.user?._id ?? null,
      assignedAt: new Date(),
    };
    let updatedProfile;
    try {
      updatedProfile = await Professional.findByIdAndUpdate(
        targetProfessionalId,
        { $push: { additionalDocuments: docEntry } },
        { new: true, runValidators: true }
      ).select("-password");
    } catch (dbErr) {
      console.error("[UPLOAD] DB error:", dbErr);
      if (dbErr.name === "ValidationError") {
        return res.status(400).json({ success: false, message: "Validation failed", errors: dbErr.errors });
      }
      throw dbErr;
    }
    if (!updatedProfile) {
      console.error("[UPLOAD] updatedProfile is null after update");
      return res.status(500).json({ success: false, message: "File saved but failed to update professional profile" });
    }
    console.log("[UPLOAD] persisted to DB. fileUrl:", fileUrl);
    return res.json({
      success: true,
      message: "File uploaded and saved to professional profile",
      filename,
      fileUrl,
      created: docEntry,
      profile: updatedProfile,
    });
  } catch (err) {
    console.error("[UPLOAD] persist error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
});

router.get("/files/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;
    const possiblePaths = [
      path.join(process.cwd(), "uploads", filename),
      path.join(__dirname, "../uploads", filename),
      path.join(__dirname, "../public/uploads", filename),
    ];
    const existingPath = possiblePaths.find((p) => fs.existsSync(p));
    if (!existingPath) {
      console.warn("[FILES] Not found:", filename);
      return res.status(404).json({ success: false, message: "File not found" });
    }
    const ext = path.extname(filename).toLowerCase();
    const mimeMap = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".txt": "text/plain",
    };
    const contentType = mimeMap[ext] || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "inline");
    res.sendFile(existingPath);
  } catch (err) {
    console.error("[FILES] Error serving file:", err);
    res.status(500).json({ success: false, message: err.message || "Error serving file" });
  }
});

router.post("/test-email", async (req, res) => {
  try {
    const { email, subject, html } = req.body;
    await sendEmail({
      email: email || process.env.SMTP_USER,
      subject: subject || "Test Email — Shaadi Undo",
      html: html || "<p>This is a test email from Shaadi Undo backend.</p>",
    });
    console.log(`[MAIL] Test email sent to ${email || process.env.SMTP_USER}`);
    res.json({ success: true, message: "Email sent successfully" });
  } catch (err) {
    console.error("[MAIL] Test email error:", err);
    res.status(500).json({ success: false, message: err.message || "Email error" });
  }
});

router.post("/register", registerProfessional);
router.post("/login", loginProfessional);
router.post("/forgot-password", forgotPassword);
router.put("/reset-password/:token", resetPassword);
router.get("/search", searchProfessionals);
router.get("/role/:role", getProfessionalsByRole);
router.get("/getAllProfessionals", getAllProfessionals);
router.get("/", getAllProfessionals);
router.get("/stats/:id", getProfessionStats);
router.get("/:id/available-slots", getAvailableSlots);
router.get("/:id", getProfessionalById);
router.put("/:id", protect, updateProfessional);
router.delete("/:id", protect, adminOnly, deleteProfessional);
router.put("/:id/approve", protect, adminOnly, approveProfessional);
router.put("/:id/reject", protect, adminOnly, rejectProfessional);
router.get("/me", protect, getCurrentProfessional);
router.post("/availability/:weekday", protect, addAvailabilitySlot);
router.delete("/availability/:weekday/:slotIndex", protect, removeAvailabilitySlot);

export default router;