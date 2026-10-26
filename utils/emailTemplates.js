export const otpEmailHtml = ({
  name = "there",
  otp = "------",
  siteName = "ShaadiUndo",
} = {}) => {
return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />

<style>
  body {
    margin: 0;
    padding: 0;
    background: #f2f4f7;
    font-family: 'Segoe UI', Roboto, Arial, sans-serif;
    color: #1a1a1a;
  }

  .wrap {
    max-width: 580px;
    margin: 30px auto;
    padding: 0 16px;
  }

  /* Beautiful gradient header using your logo colors */
  .header {
    background: linear-gradient(135deg, #0F5860, #E63946);
    padding: 26px 30px;
    color: #fff;
    border-radius: 14px 14px 0 0;
    text-align: left;
  }

  .brand {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 0.5px;
  }

  .subtitle {
    font-size: 13px;
    opacity: 0.9;
    margin-top: 3px;
  }

  /* Card body */
  .card {
    background: #fff;
    padding: 28px 30px;
    border-radius: 0 0 14px 14px;
    box-shadow: 0 8px 26px rgba(0,0,0,0.08);
  }

  .card p {
    font-size: 16px;
    line-height: 1.6;
    margin: 0 0 16px 0;
  }

  /* OTP pill */
  .otp-box {
    text-align: center;
    margin: 22px 0;
    padding: 22px;
    background: #f7fafc;
    border-radius: 12px;
    border: 1px solid #e5e7eb;
  }

  .otp {
    display: inline-block;
    background: #E63946;
    color: #fff;
    padding: 14px 38px;
    border-radius: 10px;
    font-size: 34px;
    font-weight: 800;
    letter-spacing: 4px;
    box-shadow: 0 5px 18px rgba(230,57,70,0.35);
  }

  .expiry {
    margin-top: 12px;
    font-size: 14px;
    color: #555;
  }

  /* Footer */
  .footer {
    text-align: center;
    margin-top: 22px;
    font-size: 13px;
    color: #666;
  }

  /* Mobile Responsive */
  @media (max-width: 520px) {
    .brand { font-size: 22px; }
    .card { padding: 22px 20px; }
    .otp { font-size: 26px; padding: 12px 26px; }
  }
</style>

</head>

<body>

<div class="wrap">

  <div class="header">
    <div class="brand">${siteName}</div>
    <div class="subtitle">Your Secure Verification Code</div>
  </div>

  <div class="card">
    <p>Hi ${name},</p>

    <p>Please use the OTP below to continue your verification:</p>

    <div class="otp-box">
      <div class="otp">${otp}</div>
      <div class="expiry">Valid for <strong>10 minutes</strong></div>
    </div>

    <p>If you did not request this code, you may safely ignore this email.</p>
  </div>

  <div class="footer">
    © ${new Date().getFullYear()} ${siteName}. This is an automated email — please do not reply.
  </div>

</div>

</body>
</html>`;
};
