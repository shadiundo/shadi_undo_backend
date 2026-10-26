import { Resend } from "resend";
import dotenv from "dotenv";
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);
console.log("RESEND FROM =", process.env.EMAIL_FROM);
console.log("RESEND KEY =", process.env.RESEND_API_KEY?.slice(0, 8));


export const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const response = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text,
      html,
    });

    if (response.error) {
      console.error("❌ Resend API error:", response.error);
      return { ok: false, error: response.error };
    }

    console.log("✅ Resend email sent:", response.id);
    return { ok: true, id: response.id };
  } catch (err) {
    console.error("❌ sendEmail exception:", err);
    return { ok: false, error: err.message };
  }
};
