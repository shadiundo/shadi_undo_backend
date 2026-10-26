import crypto from "crypto";
import fetch from "node-fetch";
import Appointment from "../models/Appointment.js";
import { uploadStreamFromResponse, getBucket } from "../utils/gcs.js";

function verifyDailySignature(req) {
  const signature = req.headers["x-daily-signature"];
  const secret = process.env.DAILY_WEBHOOK_SECRET;
  if (!signature || !secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(req.body)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function dailyWebhookHandler(req, res) {
  try {
    if (!verifyDailySignature(req)) return res.status(401).send("Invalid signature");

    const event = JSON.parse(req.body.toString());
    const type = event.event || event.type;
    if (!type) return res.status(200).send("Ignored");

    if (
      type === "recording.ready" ||
      type === "recording.exported" ||
      type === "recording.ready_to_download"
    ) {
      const content = event.content || event.data || {};
      const bucket = getBucket();

      const recordings = [];
      if (content.recording_url) recordings.push({ url: content.recording_url, room: content.room_name });
      if (content.recording_download_url) recordings.push({ url: content.recording_download_url, room: content.room_name });
      if (Array.isArray(content.recordings)) {
        for (const r of content.recordings) {
          if (r.download_url) recordings.push({ url: r.download_url, room: content.room });
        }
      }
      if (recordings.length === 0) return res.status(200).send("No recordings to process");

      for (const rec of recordings) {
        try {
          const resp = await fetch(rec.url);
          if (!resp.ok) continue;

          const fileName = `recordings/${rec.room || "unknown"}/${Date.now()}.mp4`;
          const uploadRes = await uploadStreamFromResponse(resp, fileName, resp.headers.get("content-type") || "video/mp4");

          const file = bucket.file(fileName);
          const [signedUrl] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + 24 * 60 * 60 * 1000,
          });

       const appt = await Appointment.findOne({ "session.roomName": rec.room }, null, { lean: false });

          if (appt) {
            appt.session.recordings = appt.session.recordings || [];
            appt.session.recordings.push({ url: signedUrl || uploadRes.publicUrl, fileName });
            await appt.save();
          }
        } catch (err) {}
      }

      return res.status(200).send("ok");
    }

    return res.status(200).send("ignored");
  } catch (err) {
    return res.status(500).send("server error");
  }
}
