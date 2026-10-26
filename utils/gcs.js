// utils/gcs.js
import { Storage } from "@google-cloud/storage";
import path from "path";

const storage = new Storage(); // ensure GOOGLE_APPLICATION_CREDENTIALS or IAM is configured
const RECORDING_BUCKET = process.env.RECORDING_BUCKET;

if (!RECORDING_BUCKET) console.warn("RECORDING_BUCKET not configured");

export function getBucket() {
  return storage.bucket(RECORDING_BUCKET);
}


export async function uploadStreamFromResponse(resp, destPath, contentType = "video/mp4") {
  if (!RECORDING_BUCKET) throw new Error("RECORDING_BUCKET not set");
  const bucket = getBucket();
  const file = bucket.file(destPath);

  return new Promise((resolve, reject) => {
    const writeStream = file.createWriteStream({
      resumable: false,
      metadata: { contentType },
    });
    resp.body.pipe(writeStream)
      .on("finish", async () => {
        try {
      
          const publicUrl = `gs://${RECORDING_BUCKET}/${destPath}`;
          resolve({ fileName: destPath, publicUrl });
        } catch (e) { reject(e); }
      })
      .on("error", (err) => reject(err));
  });
}
