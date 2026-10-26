// utils/getUserIdFromReq.js
import mongoose from "mongoose";
import Professional from "../models/Professional.js";

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id));

export async function resolveUserIdFromReq(req) {
  const rawUser = req.user || {};
  let userId = null;

  // try common fields
  const candidates = [
    rawUser._id,
    rawUser.id,
    rawUser.userId,
    rawUser.sub,         // common for JWT sub
    rawUser.uid,         // some libs
    rawUser.localId,     // other shapes
  ];

  for (const c of candidates) {
    if (c != null) {
      try {
        const s = typeof c === "string" ? c : (c.toString ? c.toString() : String(c));
        if (isValidObjectId(s)) {
          userId = s;
          break;
        }
      } catch (e) {
        // ignore
      }
    }
  }

  // fallback: try email -> lookup _id
  if ((!userId || !isValidObjectId(userId)) && rawUser.email) {
    const byEmail = await Professional.findOne({ email: String(rawUser.email).toLowerCase() }).select("_id");
    if (byEmail) userId = String(byEmail._id);
  }

  // final sanity check
  if (userId && !isValidObjectId(userId)) return null;
  return userId || null;
}
