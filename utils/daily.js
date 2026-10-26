import dotenv from "dotenv";
import fetch from "node-fetch";
import Appointment from "../models/Appointment.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

dotenv.config();

const DAILY_BASE = "https://api.daily.co/v1";
const DAILY_API_KEY = process.env.DAILY_API_KEY;
const DAILY_DOMAIN = process.env.DAILY_DOMAIN || "shaadiundo.daily.co";
const DAILY_DOMAIN_ID = process.env.DAILY_DOMAIN_ID;

if (!DAILY_API_KEY) {
  console.error("❌ DAILY_API_KEY is not set in environment variables");
}

const headers = {
  Authorization: `Bearer ${DAILY_API_KEY}`,
  "Content-Type": "application/json",
};

function validateDailyConfig() {
  if (!DAILY_API_KEY) {
    throw new Error("DAILY_API_KEY is not configured");
  }
  if (!DAILY_DOMAIN) {
    console.warn("⚠️ DAILY_DOMAIN is not set, using default");
  }
  if (!DAILY_DOMAIN_ID) {
    console.warn("⚠️ DAILY_DOMAIN_ID is not set. Self-signed tokens may be rejected.");
  }
}

export async function ensureDailyRoom(roomName, opts = {}) {
  validateDailyConfig();

  if (!roomName || typeof roomName !== "string") {
    throw new Error("Room name must be a valid string");
  }

  const cleanRoomName = roomName.replace(/[^a-zA-Z0-9-_]/g, "").substring(0, 50);

  const payload = {
    name: cleanRoomName,
    privacy: "private",
    properties: {
      enable_screenshare: true,
      start_video_off: opts.start_video_off ?? false,
      start_audio_off: false,
      enable_chat: true,
      enable_prejoin_ui: true,
      eject_at_room_exp: true,
      enable_knocking: false,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      max_participants: opts.max_participants || 20,
    },
  };

  try {
    console.log(`📌 Creating/Checking Room: ${cleanRoomName}`);

    const res = await fetch(`${DAILY_BASE}/rooms`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const responseText = await res.text();

    if (res.status === 409 || responseText.includes("already exists")) {
      console.log(`✅ Room already exists, reusing: ${cleanRoomName}`);

      const existingRoomRes = await fetch(`${DAILY_BASE}/rooms/${cleanRoomName}`, {
        headers,
        method: "GET",
      });

      if (!existingRoomRes.ok) {
        const errorText = await existingRoomRes.text();
        throw new Error(`Failed to fetch existing room: ${errorText}`);
      }

      return existingRoomRes.json();
    }

    if (!res.ok) {
      let errorMsg = `Daily room creation failed (${res.status})`;
      try {
        const errorData = JSON.parse(responseText);
        errorMsg += `: ${errorData.info || responseText}`;
      } catch {
        errorMsg += `: ${responseText}`;
      }
      throw new Error(errorMsg);
    }

    const roomData = JSON.parse(responseText);
    console.log(`✅ Room created: ${cleanRoomName}`);
    return roomData;
  } catch (error) {
    console.error("❌ ensureDailyRoom error:", error.message);
    throw error;
  }
}

export async function createMeetingToken({
  roomName,
  userName = "Guest",
  ttlSeconds = 60 * 60,
  isOwner = false,
}) {
  if (!process.env.DAILY_API_KEY) throw new Error("DAILY_API_KEY missing in environment");
  if (!process.env.DAILY_DOMAIN_ID) throw new Error("DAILY_DOMAIN_ID missing in environment");
  if (!roomName) throw new Error("roomName required");

  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(60, ttlSeconds);

  const payload = {
    iss: process.env.DAILY_API_KEY,
    room: roomName,
    domain: process.env.DAILY_DOMAIN,
    user_name: userName,
    is_owner: isOwner,
    exp,
    permissions: {
      hasPresence: true,
      canSend: ["audio", "video", "screenVideo", "screenAudio"],
      canReceive: { base: true },
      canAdmin: isOwner,
    },
    d: process.env.DAILY_DOMAIN_ID,
    iat: now,
  };

  console.log("🛠️ Signing meeting token payload:", payload);

  const token = jwt.sign(payload, process.env.DAILY_API_KEY, {
    algorithm: "HS256",
  });

  console.log(`🎫 Token Created: ${token.substring(0, 40)}...`);
  return token;
}


export async function joinSession(req, res) {
  console.log(
    "[joinSession debug] Authorization header:",
    req.header("authorization"),
    "user:",
    req.user && (req.user._id || req.user.id)
  );

  try {
    const { id: appointmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid appointment id" });
    }

    const user = req.user;
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "Auth required" });

    const appointment = await Appointment.findById(appointmentId).lean();
    if (!appointment)
      return res
        .status(404)
        .json({ success: false, message: "Appointment not found" });

    if (!appointment.session || !appointment.session.roomName) {
      return res
        .status(404)
        .json({ success: false, message: "Session not available yet" });
    }

    const callerId = user && (user._id ?? user.id);
    const isProfessional =
      String(appointment.professionalId) === String(callerId);
    const isBookingUser = String(appointment.userId) === String(callerId);
    const isAdmin = (user?.role || "").toLowerCase() === "admin";

    if (!isProfessional && !isBookingUser && !isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Not allowed to join" });
    }

    const now = Date.now();
    const expiresAtMs = appointment.session?.expiresAt
      ? new Date(appointment.session.expiresAt).getTime()
      : now + 30 * 60 * 1000;
    const ttlSeconds = Math.max(
      60,
      Math.floor((expiresAtMs - now) / 1000)
    );

    let token;
    try {
      token = await createMeetingToken({
        roomName: appointment.session.roomName,
        userName: user.name || user.email || "Participant",
        ttlSeconds,
        isOwner: isProfessional || isAdmin,
      });
    } catch (err) {
      console.error("[joinSession debug] createMeetingToken error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to create meeting token",
        error: err.message,
      });
    }

    const decodedFull = jwt.decode(token, { complete: true });
    console.log(
      "[joinSession debug] Decoded meeting token payload:",
      decodedFull
    );

    const payload = decodedFull?.payload || {};

    if (!payload.room || payload.room !== appointment.session.roomName) {
      console.error("[joinSession debug] Token room mismatch", payload);
      return res
        .status(500)
        .json({ success: false, message: "Invalid token room" });
    }

    return res.json({
      success: true,
      data: {
        roomName: appointment.session.roomName,
        token,
        ttlSeconds,
        meetingUrl: `https://${DAILY_DOMAIN}/${appointment.session.roomName}`,
      },
    });
  } catch (err) {
    console.error("joinSession error:", err);
    return res.status(500).json({
      success: false,
      message: "Unable to join session",
      error: err.message,
    });
  }
}

export async function getRoomInfo(roomName) {
  validateDailyConfig();

  const cleanRoomName = roomName.replace(/[^a-zA-Z0-9-_]/g, "");

  try {
    const res = await fetch(`${DAILY_BASE}/rooms/${cleanRoomName}`, {
      headers,
      method: "GET",
    });

    if (!res.ok) {
      if (res.status === 404) {
        return null;
      }
      const errorText = await res.text();
      throw new Error(`Failed to get room info: ${errorText}`);
    }

    return res.json();
  } catch (error) {
    console.error("❌ getRoomInfo error:", error.message);
    throw error;
  }
}

export async function deleteRoom(roomName) {
  validateDailyConfig();

  const cleanRoomName = roomName.replace(/[^a-zA-Z0-9-_]/g, "");

  try {
    const res = await fetch(`${DAILY_BASE}/rooms/${cleanRoomName}`, {
      headers,
      method: "DELETE",
    });

    const responseText = await res.text();

    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete room: ${responseText}`);
    }

    console.log(`✅ Room deleted: ${cleanRoomName}`);
    return true;
  } catch (error) {
    console.error("❌ deleteRoom error:", error.message);
    throw error;
  }
}

export async function getRoomParticipants(roomName) {
  validateDailyConfig();

  const cleanRoomName = roomName.replace(/[^a-zA-Z0-9-_]/g, "");

  try {
    const res = await fetch(`${DAILY_BASE}/rooms/${cleanRoomName}/participants`, {
      headers,
      method: "GET",
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to get participants: ${errorText}`);
    }

    const data = await res.json();
    return data.data || [];
  } catch (error) {
    console.error("❌ getRoomParticipants error:", error.message);
    throw error;
  }
}

export async function removeParticipant(roomName, participantId) {
  validateDailyConfig();

  const cleanRoomName = roomName.replace(/[^a-zA-Z0-9-_]/g, "");

  try {
    const res = await fetch(`${DAILY_BASE}/rooms/${cleanRoomName}/participants/${participantId}`, {
      headers,
      method: "DELETE",
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to remove participant: ${errorText}`);
    }

    console.log(`✅ Participant removed: ${participantId} from ${cleanRoomName}`);
    return true;
  } catch (error) {
    console.error("❌ removeParticipant error:", error.message);
    throw error;
  }
}

export async function startRecording(roomName, options = {}) {
  validateDailyConfig();

  const cleanRoomName = roomName.replace(/[^a-zA-Z0-9-_]/g, "");

  const payload = {
    room_name: cleanRoomName,
    format: options.format || "mp4",
    layout: options.layout || "single-participant",
  };

  try {
    const res = await fetch(`${DAILY_BASE}/recordings`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to start recording: ${errorText}`);
    }

    return res.json();
  } catch (error) {
    console.error("❌ startRecording error:", error.message);
    throw error;
  }
}

export async function stopRecording(recordingId) {
  validateDailyConfig();

  try {
    const res = await fetch(`${DAILY_BASE}/recordings/${recordingId}`, {
      method: "DELETE",
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to stop recording: ${errorText}`);
    }

    return true;
  } catch (error) {
    console.error("❌ stopRecording error:", error.message);
    throw error;
  }
}

export function generateMeetingUrl(roomName) {
  const cleanRoomName = roomName.replace(/[^a-zA-Z0-9-_]/g, "");
  return `https://${DAILY_DOMAIN}/${cleanRoomName}`;
}

export function generateMeetingUrlWithToken(roomName, token) {
  const cleanRoomName = roomName.replace(/[^a-zA-Z0-9-_]/g, "");
  return `https://${DAILY_DOMAIN}/${cleanRoomName}?t=${token}`;
}

export async function checkDailyHealth() {
  validateDailyConfig();

  try {
    const res = await fetch(`${DAILY_BASE}/rooms`, {
      headers,
      method: "GET",
    });

    if (res.ok) {
      console.log("✅ Daily.co API is healthy");
      return { healthy: true, message: "Daily.co API is accessible" };
    } else {
      console.error("❌ Daily.co API is not accessible");
      return {
        healthy: false,
        message: `Daily.co API returned ${res.status}: ${await res.text()}`,
      };
    }
  } catch (error) {
    console.error("❌ Daily.co health check failed:", error.message);
    return {
      healthy: false,
      message: `Daily.co health check failed: ${error.message}`,
    };
  }
}

console.log("Daily API Key used:", process.env.DAILY_API_KEY);
console.log("Daily Domain:", process.env.DAILY_DOMAIN);
console.log("Daily Domain ID:", process.env.DAILY_DOMAIN_ID);

export default {
  ensureDailyRoom,
  createMeetingToken,
  joinSession,
  getRoomInfo,
  deleteRoom,
  getRoomParticipants,
  removeParticipant,
  startRecording,
  stopRecording,
  generateMeetingUrl,
  generateMeetingUrlWithToken,
  checkDailyHealth,
};
