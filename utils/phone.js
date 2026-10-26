export const normalizePhone = (phone) => {
  if (!phone) return null;
  let s = phone.toString().trim();
  // if already in E.164 or starts with +, remove non-digits except leading +
  if (s.startsWith("+")) {
    return "+" + s.replace(/\D/g, "").replace(/^(\+)?/, "");
  }
  // remove non-digits, remove leading 0
  let cleaned = s.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.substring(1);
  if (!cleaned.startsWith("91")) cleaned = "91" + cleaned;
  return "+" + cleaned;
};
