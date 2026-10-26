import express from "express";
import { sendEmail } from "../utils/notify.js";

const router = express.Router();

router.get("/test-email", async (req, res) => {
  try {
    const result = await sendEmail({
      to: "yourgmail@gmail.com", // PUT YOUR EMAIL HERE
      subject: "Resend Test Email",
      html: "<h2>Resend is working 🎉</h2>",
    });

    res.json(result);
  } catch (err) {
    console.error("❌ Test route error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
