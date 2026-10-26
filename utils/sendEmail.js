import nodemailer from "nodemailer";

export async function sendEmail({ email, subject, html, text }) {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  const msg = {
    from,
    to: email,
    subject,
    text: text || undefined,
    html: html || undefined,
  };

  try {
    await transporter.verify();
  } catch (err) {
    console.warn("[sendEmail] transporter verify failed:", err?.message);
  }

  await transporter.sendMail(msg);
  console.log(`📧 Email sent to ${email} (${subject})`);
  return true;
}
