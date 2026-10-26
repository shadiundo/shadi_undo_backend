// scripts/test_notify.js
import dotenv from "dotenv";
dotenv.config();
import { sendEmail, sendSms } from "../utils/notify.js";

(async () => {
  const toEmail = process.argv[2] || process.env.SMTP_USER;
  const toPhone = process.argv[3]; // optional, E.164
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  console.log("Testing notify -> email:", toEmail, "phone:", toPhone);

  const emailRes = await sendEmail({
    to: toEmail,
    subject: "Test OTP",
    text: `Your test OTP is ${otp}`
  });
  console.log("Email result:", emailRes);

  if (toPhone) {
    const smsRes = await sendSms({ to: toPhone, body: `Your test OTP is ${otp}` });
    console.log("SMS result:", smsRes);
  } else {
    console.log("No phone provided; SMS skipped");
  }

  process.exit(0);
})();
