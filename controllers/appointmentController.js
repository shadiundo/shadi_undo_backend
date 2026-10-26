
import mongoose from "mongoose";
import Appointment from "../models/Appointment.js";
import Wallet from "../models/Wallet.js";
import Transaction from "../models/Transaction.js";
import Professional from "../models/Professional.js";
import { ensureDailyRoom, createMeetingToken,  } from "../utils/daily.js";
import { uploadStreamFromResponse } from "../utils/gcs.js";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import User from "../models/User.js"; 

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id));


export const placeHold = async (userId, amount, minutes, appointmentId, outerSession = null) => {
  const session = outerSession || (await mongoose.startSession());
  let createdTransaction = null;
  try {
    if (!outerSession) session.startTransaction();

    const wallet = await Wallet.findOne({ userId }).session(session);
    if (!wallet) throw new Error("Wallet not found for user");

    if ((wallet.balance || 0) < amount) {
      throw new Error("Insufficient wallet balance to place hold");
    }

    wallet.balance = Number((wallet.balance - amount).toFixed(6));
    await wallet.save({ session });

    createdTransaction = await Transaction.create(
      [
        {
          walletId: wallet._id,
          userId,
          type: "hold",
          amount,
          reference: appointmentId ? String(appointmentId) : undefined,
          meta: { minutesReserved: minutes },
          status: "success",
        },
      ],
      { session }
    );

    if (!outerSession) await session.commitTransaction();
    return createdTransaction[0];
  } catch (err) {
    if (!outerSession) await session.abortTransaction();
    throw err;
  } finally {
    if (!outerSession) session.endSession();
  }
};

export const releaseHold = async (userId, transactionId, appointmentId) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const tx = await Transaction.findById(transactionId).session(session);
    if (!tx || tx.type !== "hold") throw new Error("Hold transaction not found");

    const wallet = await Wallet.findOne({ userId }).session(session);
    if (!wallet) throw new Error("Wallet not found");

    wallet.balance = Number((wallet.balance + tx.amount).toFixed(6));
    await wallet.save({ session });

    await Transaction.create(
      [
        {
          walletId: wallet._id,
          userId,
          type: "release",
          amount: tx.amount,
          reference: appointmentId ? String(appointmentId) : undefined,
          meta: { releasedFrom: transactionId },
          status: "success",
        },
      ],
      { session }
    );

    await session.commitTransaction();
    return true;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

export const settleHoldToProfessional = async (appointmentId, hold, professionalId, platformFeePercent = 0) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    await Appointment.updateOne(
      { _id: appointmentId, "session.holds.transactionId": hold.transactionId },
      { $set: { "session.holds.$.settled": true } },
      { session }
    );

    const gross = hold.amount;
    const fee = Math.round((gross * (platformFeePercent || 0)) / 100);
    const net = gross - fee;

    await Transaction.create(
      [
        {
          walletId: null,
          userId: professionalId,
          type: "settlement",
          amount: net,
          reference: appointmentId,
          meta: { gross, fee },
          status: "success",
        },
      ],
      { session }
    );

    await session.commitTransaction();
    return { net, fee };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/* ----------------- controllers/appointments.js ----------------- */

export const createAppointment = async (req, res) => {
  try {
    const userId = req.user && (req.user._id ?? req.user.id);
    if (!userId) return res.status(401).json({ success: false, message: "Auth required" });

    const {
      professionalId,
      date,
      dayOfWeek,
      startTime,
      endTime,
      startUtc,
      endUtc,
      slotId,
      mode = "audio",
      notes,
      reserveAtBooking = true,
    } = req.body;

    if (!professionalId || !date || !dayOfWeek || (!startTime && !startUtc) || (!endTime && !endUtc)) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    if (!isValidObjectId(professionalId)) {
      return res.status(400).json({ success: false, message: "Invalid professionalId" });
    }

    const professional = await Professional.findById(professionalId);
    if (!professional) {
      return res.status(404).json({ success: false, message: "Professional not found" });
    }

    const dayAvailability = (professional.availability || []).find(
      (a) => String(a.dayOfWeek).toLowerCase() === String(dayOfWeek).toLowerCase()
    );
    if (!dayAvailability) {
      return res.status(400).json({ success: false, message: `${dayOfWeek} not available` });
    }

    const toMinutes = (t) => {
      if (!t || typeof t !== "string") return null;
      const parts = t.split(":").map(Number);
      if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
      const [h, m] = parts;
      return h * 60 + m;
    };

    let matchingSlot = null;
    const slots = Array.isArray(dayAvailability.slots) ? dayAvailability.slots : [];

    if (slotId) {
      matchingSlot = slots.find((s) => String(s._id ?? s.id) === String(slotId));
    }

    if (!matchingSlot && startUtc) {
      try {
        const sUtc = new Date(startUtc);
        const eUtc = endUtc ? new Date(endUtc) : null;
        if (!Number.isNaN(sUtc.getTime())) {
          const hh = String(sUtc.getUTCHours()).padStart(2, "0");
          const mm = String(sUtc.getUTCMinutes()).padStart(2, "0");
          const hhmm = `${hh}:${mm}`;
          const checkMin = toMinutes(hhmm);

          if (checkMin != null) {
            matchingSlot = slots.find((slot) => {
              const slotStart = toMinutes(slot.startTime);
              const slotEnd = toMinutes(slot.endTime);
              if (slotStart == null || slotEnd == null) return false;
              const modeOk = (slot.mode === mode) || (slot.mode === "audio_video") || (!slot.mode);
              return modeOk && checkMin >= slotStart && checkMin + ( (eUtc && !Number.isNaN(eUtc.getTime())) ? ((eUtc.getTime() - sUtc.getTime())/60000) : ( (toMinutes(endTime) - toMinutes(startTime)) || 0 ) ) <= slotEnd;
            });
          }
        }
      } catch (e) {}
    }

    if (!matchingSlot) {
      const startMin = toMinutes(startTime);
      const endMin = toMinutes(endTime);
      if (startMin == null || endMin == null) {
        return res.status(400).json({ success: false, message: "Invalid startTime/endTime format" });
      }
      matchingSlot = slots.find((slot) => {
        const slotStart = toMinutes(slot.startTime);
        const slotEnd = toMinutes(slot.endTime);
        if (slotStart == null || slotEnd == null) return false;
        const modeOk = (slot.mode === mode) || (slot.mode === "audio_video") || (!slot.mode);
        return modeOk && startMin >= slotStart && endMin <= slotEnd;
      });
    }

    if (!matchingSlot) {
      return res.status(400).json({ success: false, message: "Slot not available for booking" });
    }

    let scheduledStartDate;
    let scheduledEndDate;

    if (startUtc) {
      scheduledStartDate = new Date(startUtc);
      if (endUtc) {
        scheduledEndDate = new Date(endUtc);
      } else {
        const durationMin = (toMinutes(endTime) != null && toMinutes(startTime) != null) ? (toMinutes(endTime) - toMinutes(startTime)) : null;
        scheduledEndDate = durationMin != null ? new Date(scheduledStartDate.getTime() + durationMin * 60 * 1000) : null;
      }
    } else {
      scheduledStartDate = new Date(`${date}T${startTime}:00`);
      scheduledEndDate = new Date(`${date}T${endTime}:00`);
    }

    if (!scheduledStartDate || Number.isNaN(scheduledStartDate.getTime()) || !scheduledEndDate || Number.isNaN(scheduledEndDate.getTime())) {
      return res.status(400).json({ success: false, message: "Unable to compute scheduled start/end times" });
    }

    const existing = await Appointment.findOne({
      professionalId,
      status: { $nin: ["cancelled", "rejected", "completed"] },
      $or: [
        { scheduledAt: { $gte: scheduledStartDate, $lt: scheduledEndDate } },
        { scheduledAt: { $lt: scheduledStartDate }, $expr: { $gt: [{ $add: ["$scheduledAt", { $multiply: ["$durationMinutesRequested", 60000] }] }, scheduledStartDate] } }
      ],
    });

    if (existing) {
      return res.status(400).json({ success: false, message: "This time slot is already booked" });
    }

    const rawDefault = professional.defaultRate ?? 2000;
    const ratePer30m = Number(rawDefault);
    const ratePerMinute = Number((ratePer30m / 30).toFixed(6));
    const durationMinutes = Math.round((scheduledEndDate.getTime() - scheduledStartDate.getTime()) / (60 * 1000));

    if (!ratePerMinute || ratePerMinute <= 0) {
      return res.status(400).json({ success: false, message: "Invalid professional rate" });
    }

    const priceSnapshot = {
      role: professional.role,
      ratePer30m,
      ratePerMinute,
      description: `Rate at booking time`,
    };

    const amountRequired = Number((durationMinutes * ratePerMinute).toFixed(6));

    const bookingWallet = await Wallet.getOrCreate(String(userId));
    if ((bookingWallet.balance || 0) < amountRequired) {
      return res.status(402).json({
        success: false,
        message: "Insufficient wallet balance to book this appointment. Please top up your wallet.",
        requiredAmount: amountRequired,
        currentBalance: bookingWallet.balance || 0,
      });
    }

    // Create appointment
    const appointment = await Appointment.create({
      userId,
      professionalId,
      roleSnapshot: professional.role,
      scheduledAt: scheduledStartDate,
      durationMinutesRequested: durationMinutes,
      mode,
      priceSnapshot,
      notes,
      status: "requested",
      meta: {
        slotMatched: {
          slotId: matchingSlot._id ?? matchingSlot.id ?? null,
          slotStartTime: matchingSlot.startTime,
          slotEndTime: matchingSlot.endTime,
        },
        clientProvided: {
          startUtc: startUtc ?? null,
          endUtc: endUtc ?? null,
          startTime,
          endTime,
          slotId: slotId ?? null,
        }
      }
    });

    // === AUTOMATIC (IDEMPOTENT) DAILY ROOM CREATION ===
    try {
      const cleanId = String(appointment._id).replace(/[^a-zA-Z0-9-_]/g, "");
      const roomName = `session_${cleanId}`;

      // ensureDailyRoom will create or fetch existing room
      const room = await ensureDailyRoom(roomName, {
        start_video_off: (mode === "audio"),
        enable_screenshare: true,
      });

      appointment.session = appointment.session || {};
      appointment.session.roomName = room?.name || roomName;
      appointment.session.videoRoom = room?.name || roomName;
      // keep session.status as not_started (do not mark ongoing) — only start when professional triggers start
      appointment.session.status = appointment.session.status || "not_started";
      await appointment.save();
    } catch (dailyErr) {
      // Log but do not block booking. If you prefer to block booking on Daily failure,
      // return a 500 instead. Current behavior: allow booking to proceed.
      console.error("Failed to auto-create Daily room for appointment:", dailyErr);
    }

    if (reserveAtBooking) {
      try {
        const tx = await placeHold(String(userId), amountRequired, durationMinutes, appointment._id);
        appointment.session = appointment.session || {};
        appointment.session.holds = appointment.session.holds || [];
        const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
        appointment.session.holds.push({
          transactionId: tx._id,
          amount: tx.amount,
          minutesReserved: durationMinutes,
          createdAt: new Date(),
          expiresAt,
          settled: false,
        });
        appointment.session.expiresAt = expiresAt;
        appointment.session.status = appointment.session.status || "not_started";
        await appointment.save();
      } catch (err) {
        await Appointment.deleteOne({ _id: appointment._id }).catch(() => {});
        return res.status(402).json({ success: false, message: `Failed to reserve funds: ${err.message}` });
      }
    }

    return res.status(201).json({
      success: true,
      message: "Appointment booked successfully",
      appointment,
      requiredAmount: amountRequired,
    });
  } catch (err) {
    console.error("createAppointment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const professionalRespond = async (req, res) => {
  try {
    const professionalId = req.user && (req.user._id ?? req.user.id);
    if (!professionalId) return res.status(401).json({ success: false, message: "Auth required" });

    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const { accept, message } = req.body;

    const appt = await Appointment.findById(id);
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });
    if (String(appt.professionalId) !== String(professionalId)) return res.status(403).json({ success: false, message: "Not permitted" });

    appt.profResponse = {
      accepted: !!accept,
      message: typeof message === "string" ? message.trim() : "",
      respondedAt: new Date(),
      by: professionalId,
    };

    if (accept) {
      appt.status = "confirmed";
      appt.rejection = undefined;
      await appt.save();
      return res.json({ success: true, appointment: appt, message: "Appointment accepted" });
    }

    const holds = (appt.session && Array.isArray(appt.session.holds)) ? appt.session.holds : [];

    let totalRefunded = 0;
    const released = [];
    const failed = [];

    for (const h of holds) {
      if (h.settled || h.released) continue;

      const txId = h.transactionId;
      if (!txId) {
        failed.push({ transactionId: null, reason: "missing transactionId on hold", hold: h });
        continue;
      }
      try {
        await releaseHold(String(appt.userId), txId, appt._id);
        h.released = true;
        h.settled = true;
        h.releasedAt = new Date();

        const amt = Number(h.amount || 0);
        totalRefunded += amt;
        released.push({ transactionId: txId, amount: amt });
      } catch (err) {
        console.error("releaseHold failed for tx", txId, err);
        failed.push({ transactionId: txId, reason: err && err.message ? err.message : String(err) });
      }
    }

    appt.status = "rejected";
    appt.session = appt.session || {};
    appt.session.holds = holds;
    appt.session.status = appt.session.status || "rejected";

    appt.rejection = {
      message: appt.profResponse.message || "",
      refundedAmount: totalRefunded,
      refundedDetails: released,
      failedReleases: failed,
      at: new Date(),
      by: professionalId,
    };

    await appt.save();

    const response = {
      success: true,
      appointment: appt,
      refunded: {
        total: Number((totalRefunded || 0).toFixed(6)),
        details: released,
        failed: failed,
      },
      message:
        released.length > 0
          ? `Appointment rejected; refunded ${released.length} hold(s) to booking user.`
          : (failed.length > 0
            ? "Appointment rejected; failed to release holds automatically (manual intervention required)."
            : "Appointment rejected; no unsettled holds to release."),
    };

    if (holds.length > 0 && released.length === 0 && failed.length > 0) {
      response.warning = "No holds released automatically; please refund user manually or investigate transactions.";
    }

    return res.json(response);
  } catch (err) {
    console.error("professionalRespond error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

/* ----------------- Start / Session management ----------------- */

export const startAppointment = async (req, res) => {
  try {
    const callerId = req.user && (req.user._id ?? req.user.id);
    if (!callerId) return res.status(401).json({ success: false, message: "Auth required" });

    const { id } = req.params;
    const { initialMinutes = 30 } = req.body;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });

    const appt = await Appointment.findById(id);
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    if (String(appt.professionalId) !== String(callerId)) {
      return res.status(403).json({ success: false, message: "Only the professional may start this session" });
    }

    if (appt.status !== "confirmed") return res.status(400).json({ success: false, message: "Appointment must be confirmed" });

    const minutes = Math.max(30, Number(initialMinutes || 30));

    const ratePerMinute =
      appt.priceSnapshot?.ratePerMinute ||
      (appt.priceSnapshot?.ratePer30m ? appt.priceSnapshot.ratePer30m / 30 : 0);

    if (!ratePerMinute || ratePerMinute <= 0) return res.status(400).json({ success: false, message: "Invalid rate" });

    const amountToHold = Number((minutes * ratePerMinute).toFixed(6));

    appt.session = appt.session || {};
    appt.session.holds = appt.session.holds || [];

    const unsettledHolds = (appt.session.holds || []).filter(h => !h.settled && !h.released);
    const existingHeldAmount = unsettledHolds.reduce((s, h) => s + (Number(h.amount) || 0), 0);

    let createdTx = null;
    let additionalHeldAmount = 0;

    if (existingHeldAmount < amountToHold) {
      const extraNeeded = Number((amountToHold - existingHeldAmount).toFixed(6));
      const bookingUserId = String(appt.userId);
      const bookingWallet = await Wallet.getOrCreate(bookingUserId);

      if ((bookingWallet.balance || 0) < extraNeeded) {
        return res.status(402).json({
          success: false,
          message: "Booking user's wallet has insufficient funds for the required additional hold.",
          requiredAdditional: extraNeeded,
          currentBalance: bookingWallet.balance || 0,
          existingHeld: existingHeldAmount,
          totalRequired: amountToHold,
        });
      }

      try {
        createdTx = await placeHold(bookingUserId, extraNeeded, minutes, appt._id);
        additionalHeldAmount = createdTx.amount || extraNeeded;

        const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
        appt.session.holds.push({
          transactionId: createdTx._id,
          amount: createdTx.amount,
          minutesReserved: minutes,
          createdAt: new Date(),
          expiresAt,
          settled: false,
        });
      } catch (err) {
        return res.status(402).json({ success: false, message: `Hold failed: ${err.message}` });
      }
    }

    const startedAt = appt.session?.startedAt || new Date();
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
    const minEndTime = new Date(Date.now() + 30 * 60 * 1000);

    appt.session.startedAt = startedAt;
    appt.session.status = "ongoing";
    appt.session.expiresAt = expiresAt;
    appt.session.minEndTime = minEndTime;
    appt.session.participants = appt.session.participants || { professionalJoined: false, userJoined: false };

    appt.status = "ongoing";

    await appt.save();

    return res.json({
      success: true,
      message: createdTx ? "Session started; additional hold placed." : "Session started; existing reserved funds used.",
      session: {
        startedAt: startedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        minEndTime: minEndTime.toISOString(),
        reservedAmountTotal: Number(((existingHeldAmount || 0) + additionalHeldAmount).toFixed(6)),
        requiredAmount: amountToHold,
        existingHeldAmount,
        additionalHeldAmount,
        reservedMinutes: minutes,
      },
    });
  } catch (err) {
    console.error("startAppointment error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


export async function startRealTimeSession(req, res) {
  try {
    const appointmentId = req.params.id;
    const user = req.user;

    if (!appointmentId || !isValidObjectId(appointmentId)) {
      return res.status(400).json({ success: false, message: "Invalid appointment id" });
    }
    if (!user) return res.status(401).json({ success: false, message: "Auth required" });

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    const callerId = user._id || user.id;
    const isProfessional = String(appointment.professionalId) === String(callerId);
    const isAdmin = (user?.role || "").toString().toLowerCase() === "admin";

    if (!isProfessional && !isAdmin) {
      return res.status(403).json({ success: false, message: "Unauthorized to start session" });
    }

    // sanitize room name
    const cleanId = String(appointment._id).replace(/[^a-zA-Z0-9-_]/g, "");
    const roomName = `session_${cleanId}`;

    // Create or ensure room exists
    try {
      await ensureDailyRoom(roomName, {
        start_video_off: appointment.mode === "audio",
        enable_screenshare: true,
      });
    } catch (dailyErr) {
      console.error("🚨 DAILY ERROR (ensureDailyRoom):", dailyErr);
      return res.status(500).json({
        success: false,
        message: "Daily room creation failed",
        error: dailyErr?.message || String(dailyErr),
      });
    }

    // Save session details BEFORE token creation
    const previousSession = appointment.session ? { ...appointment.session } : null;
    const previousStatus = appointment.status;

    const minutes = appointment.durationMinutesRequested || 30;
    const now = new Date();

    appointment.session = {
      ...(appointment.session || {}),
      roomName,
      videoRoom: roomName,
      startedAt: appointment.session?.startedAt || now,
      expiresAt: new Date(Date.now() + minutes * 60 * 1000),
      minEndTime: appointment.session?.minEndTime || new Date(Date.now() + 30 * 60 * 1000),
      status: "ongoing",
      participants: appointment.session?.participants || {
        professionalJoined: false,
        userJoined: false,
      },
    };

    appointment.status = "ongoing";
    await appointment.save();

    // --- TOKEN CREATION ---
    let tokenStr;
    try {
      tokenStr = await createMeetingToken({
        roomName,
        userName: user.name || user.email || "User",
        ttlSeconds: Math.max(60, minutes * 60),
        isOwner: isProfessional || isAdmin,
        properties: {
          start_video_off: appointment.mode === "audio"
        },
      });

      if (!tokenStr) throw new Error("createMeetingToken returned empty token");

    } catch (tokenErr) {
      console.error("🚨 TOKEN GENERATION FAILED (startRealTimeSession):", tokenErr);

      try {
        appointment.session = previousSession || undefined;
        appointment.status = previousStatus || "confirmed";
        await appointment.save();
      } catch (rollbackErr) {
        console.error("ROLLBACK FAILED:", rollbackErr);
      }

      return res.status(500).json({
        success: false,
        message: "Failed to generate meeting token",
        error: tokenErr?.message || String(tokenErr),
      });
    }

    // -------------------------------------------------------------------------
    // 🔍 TOKEN DEBUG BLOCK (THIS IS WHAT YOU ASKED FOR)
    // -------------------------------------------------------------------------
    try {
      const decoded = jwt.decode(tokenStr, { complete: true });
      console.log("DEBUG: created token payload:\n", JSON.stringify(decoded?.payload, null, 2));
    } catch (e) {
      console.error("DEBUG: failed to decode token:", e);
    }
    // -------------------------------------------------------------------------

    // In your appointments controller, update startRealTimeSession return
return res.json({
  success: true,
  data: {
    roomName,
    token: tokenStr,  // This is the key field
    meetingUrl: `https://${process.env.DAILY_DOMAIN || "shaadiundo.daily.co"}/${roomName}`,
    ttlSeconds: Math.max(60, minutes * 60),
  },
});

  } catch (err) {
    console.error("🔥 FATAL ERROR startRealTimeSession:", err);
    return res.status(500).json({
      success: false,
      message: "Could not create session",
      error: err.message,
    });
  }
}





export const getSessionRoom = async (req, res) => {
  try {
    const callerId = req.user && (req.user._id ?? req.user.id);
    if (!callerId) return res.status(401).json({ success: false, message: "Auth required" });

    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });

    const appt = await Appointment.findById(id).lean();
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    const isProfessional = String(appt.professionalId) === String(callerId);
    const isBookingUser = String(appt.userId) === String(callerId);
    const isAdmin = req.user?.role === "admin";

    if (!isProfessional && !isBookingUser && !isAdmin) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    const session = appt.session || {};
    const hasRoom = !!session.videoRoom;

    return res.json({
      success: true,
      started: Boolean(hasRoom),
      roomName: hasRoom ? session.videoRoom : null,
    meetingUrl: hasRoom
  ? `https://${process.env.DAILY_DOMAIN}/${session.videoRoom}`
  : null,

      mode: appt.mode || "audio",
      session: {
        startedAt: session.startedAt || null,
        expiresAt: session.expiresAt || null,
        status: session.status || null,
        participants: session.participants || { professionalJoined: false, userJoined: false },
      },
    });
  } catch (err) {
    console.error("getSessionRoom error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


export async function joinSession(req, res) {
  console.log(
    "[joinSession debug] Authorization header:",
    req.header("authorization"),
    "user:",
    req.user && (req.user._id || req.user.id)
  );

  try {
    const appointmentId = req.params.id;
    const user = req.user;

    if (!appointmentId || !isValidObjectId(appointmentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid appointment id" });
    }

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Auth required" });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res
        .status(404)
        .json({ success: false, message: "Appointment not found" });
    }

    if (!appointment.session || !appointment.session.roomName) {
      return res
        .status(404)
        .json({ success: false, message: "Session not available yet" });
    }

    const callerId = user && (user._id ?? user.id);
    const isProfessional = String(appointment.professionalId) === String(callerId);
    const isBookingUser = String(appointment.userId) === String(callerId);
    const isAdmin = (user?.role || "").toString().toLowerCase() === "admin";

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

      if (!token) {
        throw new Error("createMeetingToken returned empty token");
      }
    } catch (err) {
      console.error("joinSession: createMeetingToken failed:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to create meeting token",
        error: err.message || String(err),
      });
    }

    try {
      const decoded = jwt.decode(token, { complete: true });
      console.log(
        "[joinSession debug] Decoded meeting token payload:",
        decoded
      );

      const payload = decoded?.payload || {};

      // IMPORTANT: we now validate `room`, not `properties.room_name`
      if (!payload.room || payload.room !== appointment.session.roomName) {
        console.error("[joinSession debug] Token room mismatch", {
          tokenRoom: payload.room,
          expected: appointment.session.roomName,
        });
        return res.status(500).json({
          success: false,
          message: "Invalid token room",
        });
      }
    } catch (decodeErr) {
      console.error("[joinSession debug] token decode/check failed:", decodeErr);
      return res.status(500).json({
        success: false,
        message: "Failed to verify meeting token",
        error: decodeErr.message || String(decodeErr),
      });
    }

    appointment.session.participants = appointment.session.participants || {};
    if (isProfessional) appointment.session.participants.professionalJoined = true;
    if (isBookingUser) appointment.session.participants.userJoined = true;
    if (
      appointment.session.participants.professionalJoined &&
      appointment.session.participants.userJoined
    ) {
      appointment.session.participants.bothJoinedAt =
        appointment.session.participants.bothJoinedAt || new Date();
    }
    await appointment.save();

    return res.json({
      success: true,
      data: {
        roomName: appointment.session.roomName,
        token,
        ttlSeconds,
        meetingUrl: `https://${process.env.DAILY_DOMAIN || "shaadiundo.daily.co"}/${appointment.session.roomName}`,
      },
    });
  } catch (err) {
    console.error("joinSession error:", err);
    return res.status(500).json({
      success: false,
      message: "Unable to join session",
      error: err.message || String(err),
    });
  }
}




export const updateParticipants = async (req, res) => {
  try {
    const callerId = req.user && (req.user._id ?? req.user.id);
    if (!callerId) return res.status(401).json({ success: false, message: "Auth required" });

    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });

    const { professionalJoined, userJoined } = req.body;
    const appt = await Appointment.findById(id);
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    // If session.locked is true, another process is updating — avoid permanent lock by short-circuiting
    if (appt.session?.locked) {
      return res.status(409).json({ success: false, message: "Session locked" });
    }

    // Acquire lock (persist), use try/finally to always release
    appt.session = appt.session || {};
    appt.session.locked = true;
    await appt.save();

    try {
      const isProfessional = String(appt.professionalId) === String(callerId);
      const isBookingUser = String(appt.userId) === String(callerId);
      const isAdmin = (req.user?.role || "").toString().toLowerCase() === "admin";

      if (!isProfessional && !isBookingUser && !isAdmin) {
        return res.status(403).json({ success: false, message: "Not permitted to update participants" });
      }

      // Ensure participants object exists
      appt.session.participants = appt.session.participants || { professionalJoined: false, userJoined: false };

      if (typeof professionalJoined === "boolean") appt.session.participants.professionalJoined = professionalJoined;
      if (typeof userJoined === "boolean") appt.session.participants.userJoined = userJoined;

      if (appt.session.participants.professionalJoined && appt.session.participants.userJoined) {
        appt.session.participants.bothJoinedAt = appt.session.participants.bothJoinedAt || new Date();
      }

      // save updated participants (still locked until finally block)
      await appt.save();

      return res.json({ success: true, participants: appt.session.participants });
    } finally {
      // Always clear the lock — even if the inner logic returned or threw
      try {
        const doc = await Appointment.findById(id);
        if (doc && doc.session) {
          doc.session.locked = false;
          // Save only if necessary; avoiding overwriting concurrent updates is important,
          // but we simplify: possible tiny race window is acceptable vs permanent lock bug.
          await doc.save();
        }
      } catch (unlockErr) {
        console.error("Failed to clear session lock for appointment", id, unlockErr);
        // do not throw here; we must not hide the main response
      }
    }
  } catch (err) {
    console.error("updateParticipants error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


/* ----------------- Extend / End flows ----------------- */

export const extendAppointment = async (req, res) => {
  try {
    const userId = req.user && (req.user._id ?? req.user.id);
    if (!userId) return res.status(401).json({ success: false, message: "Auth required" });

    const { id } = req.params;
    const { minutes = 30 } = req.body;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });

    const appt = await Appointment.findById(id);
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    if (String(appt.userId) !== String(userId)) return res.status(403).json({ success: false, message: "Only booking user can extend" });

    if (!appt.session || appt.session.status !== "ongoing") return res.status(400).json({ success: false, message: "Session is not ongoing" });

    const allowed = [15, 30];
    if (!allowed.includes(Number(minutes))) return res.status(400).json({ success: false, message: "Allowed extensions: 15 or 30 minutes" });

    const ratePerMinute = appt.priceSnapshot?.ratePerMinute || (appt.priceSnapshot?.ratePer30m ? appt.priceSnapshot.ratePer30m / 30 : 0);
    const amountToHold = Number((minutes * ratePerMinute).toFixed(6));

    const wallet = await Wallet.getOrCreate(userId);
    if ((wallet.balance || 0) < amountToHold) {
      return res.status(402).json({ success: false, message: "Insufficient funds for extension. Please top up wallet." });
    }

    let tx;
    try {
      tx = await placeHold(userId, amountToHold, minutes, appt._id);
    } catch (err) {
      return res.status(402).json({ success: false, message: `Hold failed: ${err.message}` });
    }

    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    appt.session.holds.push({
      transactionId: tx._id,
      amount: tx.amount,
      minutesReserved: minutes,
      createdAt: new Date(),
      expiresAt,
      settled: false,
    });

    // extend overall session.expiresAt to now + minutes
    appt.session.expiresAt = expiresAt;
    await appt.save();

    return res.json({
      success: true,
      message: "Extended; hold placed.",
      reserved: { amount: tx.amount, minutesReserved: minutes, expiresAt: expiresAt.toISOString() },
    });
  } catch (err) {
    console.error("extendAppointment error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const endAppointment = async (req, res) => {
  try {
    const callerId = req.user && (req.user._id ?? req.user.id);
    if (!callerId) return res.status(401).json({ success: false, message: "Auth required" });

    const { id } = req.params;
    const endedAt = req.body.endedAt ? new Date(req.body.endedAt) : new Date();

    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid appointment id" });

    const appt = await Appointment.findById(id);
    if (!appt) return res.status(404).json({ success: false, message: "Appointment not found" });

    if (String(appt.userId) !== String(callerId) && String(appt.professionalId) !== String(callerId)) {
      return res.status(403).json({ success: false, message: "Not permitted" });
    }

    if (!appt.session || !appt.session.startedAt) return res.status(400).json({ success: false, message: "Session not started" });

    if (String(appt.professionalId) === String(callerId)) {
      const minEndTime = appt.session?.minEndTime ? new Date(appt.session.minEndTime) : null;
      const participants = appt.session?.participants || { professionalJoined: false, userJoined: false };
      const bothWerePresent = !!(participants.professionalJoined && participants.userJoined);
      if (bothWerePresent && minEndTime && new Date() < minEndTime) {
        return res.status(403).json({ success: false, message: "Professional cannot end the session before minimum reserved time while both participants were present" });
      }
    }

    const started = new Date(appt.session.startedAt);
    const msUsed = Math.max(0, endedAt - started);
   const actualMinutes = Math.max(1, Math.ceil(msUsed / 60000));

    const holds = appt.session.holds || [];
    const totalHeld = holds.reduce((acc, h) => acc + (h.amount || 0), 0);
    const totalReservedMinutes = holds.reduce((acc, h) => acc + (h.minutesReserved || 0), 0);

    const initialReservedMinutes = (holds.length && holds[0].minutesReserved) ? Number(holds[0].minutesReserved) : 30;

    const ratePerMinute = appt.priceSnapshot?.ratePerMinute || (appt.priceSnapshot?.ratePer30m ? appt.priceSnapshot.ratePer30m / 30 : 0);

    const participants = appt.session?.participants || {};
    const userEverJoined = !!participants.userJoined || !!participants.bothJoinedAt;
    const bothWerePresent = !!(participants.professionalJoined && participants.userJoined) || !!participants.bothJoinedAt;

    if (!userEverJoined) {
      try {
        for (const h of appt.session.holds || []) {
          if (!h.settled) {
            await releaseHold(String(appt.userId), h.transactionId, appt._id);
            h.settled = true;
            h.released = true;
          }
        }
        appt.session.endedAt = endedAt;
        appt.session.status = "ended";
        appt.status = "cancelled";
        await appt.save();
        return res.json({
          success: true,
          message: "Session ended. Booking user never joined — reserved holds refunded.",
          billing: { actualMinutes, totalHeldRefunded: totalHeld },
        });
      } catch (err) {
        console.error("refund-on-no-user error:", err);
        return res.status(500).json({ success: false, message: "Failed to refund holds after ending session" });
      }
    }

    let billableMinutes = Math.max(actualMinutes, initialReservedMinutes);
    billableMinutes = Math.min(billableMinutes, totalReservedMinutes);
    const expectedAmount = Number((billableMinutes * ratePerMinute).toFixed(6));

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      appt.session.endedAt = endedAt;
      appt.session.status = "ended";
      appt.status = "completed";

      let toTransfer = Math.min(totalHeld, expectedAmount);
      let refundAmount = Math.max(0, totalHeld - expectedAmount);
      let shortfall = Math.max(0, expectedAmount - totalHeld);

      if (shortfall > 0) {
        const wallet = await Wallet.findOne({ userId: appt.userId }).session(session);
        if (!wallet) throw new Error("Wallet not found");
        if ((wallet.balance || 0) >= shortfall) {
          wallet.balance = Number((wallet.balance - shortfall).toFixed(6));
          await wallet.save({ session });
          await Transaction.create([{
            walletId: wallet._id,
            userId: appt.userId,
            type: "debit",
            amount: shortfall,
            reference: appt._id,
            meta: { reason: "session shortfall" },
            status: "success",
          }], { session });
          toTransfer += shortfall;
          shortfall = 0;
        } else {
          appt.session.status = "pending_payment";
          appt.status = "pending_payment";
          await appt.save({ session });
          await session.commitTransaction();
          session.endSession();
          return res.json({ success: false, message: "Insufficient wallet funds to cover session shortfall. Please top up.", shortfall });
        }
      }

      for (const h of appt.session.holds || []) {
        if (!h.settled) {
          await Transaction.updateOne({ _id: h.transactionId }, { $set: { status: "success" } }).session(session);
          h.settled = true;
        }
      }

      const platformFeePercent = 0;
      const fee = Math.round((toTransfer * platformFeePercent) / 100);
      const net = toTransfer - fee;

      await Transaction.create([{
        walletId: null,
        userId: appt.professionalId,
        type: "settlement",
        amount: net,
        reference: appt._id,
        meta: { gross: toTransfer, fee },
        status: "success"
      }], { session });

      if (refundAmount > 0) {
        const wallet = await Wallet.findOne({ userId: appt.userId }).session(session);
        if (!wallet) throw new Error("User wallet missing for refund");
        wallet.balance = Number((wallet.balance + refundAmount).toFixed(6));
        await wallet.save({ session });
        await Transaction.create([{
          walletId: wallet._id,
          userId: appt.userId,
          type: "release",
          amount: refundAmount,
          reference: appt._id,
          meta: { reason: "refund for unused reserved time" },
          status: "success"
        }], { session });
      }

      await appt.save({ session });
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    return res.json({
      success: true,
      message: "Session ended and billing processed.",
      billing: { actualMinutes, billableMinutes, expectedAmount, totalHeld, refundAmount: Math.max(0, totalHeld - expectedAmount) }
    });
  } catch (err) {
    console.error("endAppointment error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ----------------- Wallet / misc ----------------- */

export const topupWallet = async (req, res) => {
  try {
    const callerId = req.user && (req.user._id ?? req.user.id);
    if (!callerId) return res.status(401).json({ success: false, message: "Auth required" });

    let { amount, userId: targetUserId } = req.body;
    if (!targetUserId) targetUserId = callerId;

    if (String(targetUserId) !== String(callerId) && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only admin can topup other users' wallets" });
    }

    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "Invalid amount" });

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      let wallet = await Wallet.findOne({ userId: targetUserId }).session(session);
      if (!wallet) {
        const created = await Wallet.create([{ userId: targetUserId, balance: 0 }], { session });
        wallet = created[0];
      }

      wallet.balance = Number((wallet.balance + Number(amount)).toFixed(6));
      await wallet.save({ session });

      await Transaction.create(
        [
          {
            walletId: wallet._id,
            userId: targetUserId,
            type: "credit",
            amount: Number(amount),
            reference: null,
            meta: { method: "manual_topup", by: callerId },
            status: "success",
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return res.json({ success: true, wallet });
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  } catch (err) {
    console.error("topupWallet error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getWallet = async (req, res) => {
  try {
    const userId = req.user && (req.user._id ?? req.user.id);
    if (!userId) return res.status(401).json({ success: false, message: "Auth required" });
    const wallet = await Wallet.getOrCreate(userId);
    return res.json({ success: true, wallet });
  } catch (err) {
    console.error("getWallet error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getTransactions = async (req, res) => {
  try {
    const userId = req.user && (req.user._id ?? req.user.id);
    if (!userId) return res.status(401).json({ success: false, message: "Auth required" });

    const txs = await Transaction.find({ userId }).sort({ createdAt: -1 }).limit(200);
    return res.json({ success: true, transactions: txs });
  } catch (err) {
    console.error("getTransactions error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getRecentAppointments = async (req, res) => {
  try {
    const appointments = await Appointment.find()
      .populate("userId", "name email")
      .populate("professionalId", "name role")
      .sort({ createdAt: -1 })
      .limit(10);

    const formatted = appointments.map((a) => ({
      id: a._id,
      user: a.userId?.name || "N/A",
      professional: a.professionalId?.name || "N/A",
      role: a.professionalId?.role || a.roleSnapshot,
      date: a.scheduledAt,
      amount: a.priceSnapshot?.ratePer30m || 0,
      status: a.status,
      notes: a.notes,
    }));

    return res.json({ success: true, data: formatted });
  } catch (err) {
    console.error("getRecentAppointments error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getProfessionalRecentAppointments = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: "Auth required" });

    const PROFESSIONAL_ROLES = ["professional", "counsellor", "counselor", "therapist", "mediator", "lawyer"];
    const ADMIN_ROLES = ["admin", "administrator", "superadmin"];
    const role = (user.role || "").toString().toLowerCase();

    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 6)));

    let targetProfessionalId = null;
    if (PROFESSIONAL_ROLES.includes(role)) {
      targetProfessionalId = user._id;
    } else if (ADMIN_ROLES.includes(role)) {
      const qId = req.query.professionalId;
      if (!qId) {
        return res.status(400).json({ success: false, message: "admin must provide professionalId query parameter" });
      }
      if (!mongoose.Types.ObjectId.isValid(qId)) {
        return res.status(400).json({ success: false, message: "invalid professionalId" });
      }
      targetProfessionalId = qId;
    } else {
      return res.status(403).json({ success: false, message: "Forbidden: only professionals or admins may access this endpoint" });
    }

    const appointments = await Appointment.find({ professionalId: targetProfessionalId })
      .populate("userId", "name email")
      .populate("professionalId", "name role")
      .sort({ scheduledAt: -1 })
      .limit(limit)
      .lean();

    const computeAmount = (a) => {
      const price = a.priceSnapshot || {};
      const duration = a.durationMinutesRequested || 30;
      if (typeof price.ratePerMinute === "number") {
        return price.ratePerMinute * duration;
      }
      if (typeof price.ratePer30m === "number") {
        return (price.ratePer30m / 30) * duration;
      }
      return typeof a.amount === "number" ? a.amount : 0;
    };

    const formatted = appointments.map((a) => ({
      id: a._id,
      user: (a.userId && (a.userId.name || a.userId.email)) || "N/A",
      userId: a.userId?._id || null,
      professional: a.professionalId?.name || "N/A",
      professionalId: a.professionalId?._id || targetProfessionalId,
      role: a.professionalId?.role || a.roleSnapshot || null,
      date: a.scheduledAt,
      durationMinutesRequested: a.durationMinutesRequested || null,
      amount: computeAmount(a),
      status: a.status,
      notes: a.notes || "",
    }));

    return res.json({ success: true, data: formatted });
  } catch (err) {
    console.error("getProfessionalRecentAppointments error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getAppointmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await Appointment.findById(id)
      .populate("userId", "name email wallet")
      .populate("professionalId", "name tier")
      .lean();

    if (!appointment)
      return res.status(404).json({ success: false, message: "Appointment not found" });

    return res.status(200).json({ success: true, appointment });
  } catch (err) {
    console.error("getAppointmentById error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};  



export const getAppointmentStats = async (req, res) => {
  try {
    const ROLES = ["lawyer", "mediator", "counsellor", "therapist"];

    const { period = "month", year } = req.query;

    const now = new Date();

    let currentStart, currentEnd, previousStart, previousEnd;

    // ---------------- DATE RANGE LOGIC ----------------

    if (period === "previous_month") {
      currentStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      currentEnd = new Date(now.getFullYear(), now.getMonth(), 1);

      previousStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      previousEnd = currentStart;
    } 
    else if (period === "year") {
      const targetYear = year ? Number(year) : now.getFullYear();

      currentStart = new Date(targetYear, 0, 1);
      currentEnd = new Date(targetYear + 1, 0, 1);

      previousStart = new Date(targetYear - 1, 0, 1);
      previousEnd = currentStart;
    } 
    else {
      // DEFAULT: current month
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
      currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousEnd = currentStart;
    }

    // ---------------- AGGREGATIONS ----------------

    const [current, previous] = await Promise.all([
      Appointment.aggregate([
        {
          $match: {
            createdAt: { $gte: currentStart, $lt: currentEnd },
          },
        },
        {
          $group: {
            _id: "$roleSnapshot",
            count: { $sum: 1 },
          },
        },
      ]),
      Appointment.aggregate([
        {
          $match: {
            createdAt: { $gte: previousStart, $lt: previousEnd },
          },
        },
        {
          $group: {
            _id: "$roleSnapshot",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // ---------------- MAP RESULTS ----------------

    const currentMap = {};
    current.forEach((c) => c._id && (currentMap[c._id] = c.count));

    const previousMap = {};
    previous.forEach((p) => p._id && (previousMap[p._id] = p.count));

    const totalCurrent = ROLES.reduce(
      (sum, role) => sum + (currentMap[role] || 0),
      0
    );

    // ---------------- NORMALIZED RESPONSE ----------------

    const categories = ROLES.map((role) => {
      const currentCount = currentMap[role] || 0;
      const prevCount = previousMap[role] || 0;

      const percent = totalCurrent
        ? Number(((currentCount / totalCurrent) * 100).toFixed(2))
        : 0;

      let rawChange = 0;
      if (prevCount > 0) {
        rawChange = ((currentCount - prevCount) / prevCount) * 100;
      } else if (currentCount > 0) {
        rawChange = 100;
      }

      return {
        role,
        count: currentCount,
        percent,
        changePercent: Number(Math.abs(rawChange).toFixed(2)),
        trend:
          prevCount === 0 && currentCount === 0
            ? "neutral"
            : rawChange >= 0
            ? "up"
            : "down",
      };
    });

    return res.json({
      success: true,
      period,
      range: {
        currentStart,
        currentEnd,
        previousStart,
        previousEnd,
      },
      total: totalCurrent,
      categories,
    });
  } catch (err) {
    console.error("getAppointmentStats error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};




export const getRevenueAndBookingsOverview = async (req, res) => {
  try {
    const { period = "year", year, month } = req.query;

    const now = new Date();
    const targetYear = year ? Number(year) : now.getFullYear();

    let startDate, endDate, groupExpr, labels;

    // ---------------- DATE RANGE ----------------
    if (period === "month") {
      const targetMonth =
        month != null ? Number(month) : now.getMonth(); // 0-11

      startDate = new Date(targetYear, targetMonth, 1);
      endDate = new Date(targetYear, targetMonth + 1, 1);

      groupExpr = { $dayOfMonth: "$scheduledAt" };

      // days in month
      const daysInMonth = new Date(
        targetYear,
        targetMonth + 1,
        0
      ).getDate();

      labels = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    } else {
      // YEAR VIEW
      startDate = new Date(targetYear, 0, 1);
      endDate = new Date(targetYear + 1, 0, 1);

      groupExpr = { $month: "$scheduledAt" };

      labels = [
        "Jan","Feb","Mar","Apr","May","Jun",
        "Jul","Aug","Sep","Oct","Nov","Dec",
      ];
    }

    // ---------------- BOOKINGS (Appointments) ----------------
    const bookingsAgg = await Appointment.aggregate([
      {
        $match: {
          scheduledAt: { $gte: startDate, $lt: endDate },
          status: { $in: ["confirmed", "completed"] },
        },
      },
      {
        $group: {
          _id: groupExpr,
          totalBookings: { $sum: 1 },
        },
      },
    ]);

    // ---------------- REVENUE (Settlements incl. extensions) ----------------
    const revenueAgg = await Transaction.aggregate([
      {
        $match: {
          type: "settlement", // ✅ includes extensions automatically
          createdAt: { $gte: startDate, $lt: endDate },
        },
      },
      {
        $group: {
          _id:
            period === "month"
              ? { $dayOfMonth: "$createdAt" }
              : { $month: "$createdAt" },
          totalRevenue: { $sum: "$amount" },
        },
      },
    ]);

    // ---------------- NORMALIZE ----------------
    const revenueArr = Array(labels.length).fill(0);
    const bookingsArr = Array(labels.length).fill(0);

    bookingsAgg.forEach((b) => {
      const index = b._id - 1;
      if (index >= 0 && index < bookingsArr.length) {
        bookingsArr[index] = b.totalBookings;
      }
    });

    revenueAgg.forEach((r) => {
      const index = r._id - 1;
      if (index >= 0 && index < revenueArr.length) {
        revenueArr[index] = Math.round(r.totalRevenue);
      }
    });

    // ---------------- RESPONSE ----------------
    res.json({
      success: true,
      period,
      year: targetYear,
      month: period === "month" ? Number(month ?? now.getMonth()) : null,
      range: {
        start: startDate,
        end: endDate,
      },
      labels,
      bookings: bookingsArr,
      revenue: revenueArr,
    });
  } catch (err) {
    console.error("getRevenueAndBookingsOverview error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};



export default {
  placeHold,
  releaseHold,
  settleHoldToProfessional,
  createAppointment,
  professionalRespond,
  startAppointment,
  extendAppointment,
  endAppointment,
  topupWallet,
  getWallet,
  getTransactions,
  getRecentAppointments,
  getProfessionalRecentAppointments,
  startRealTimeSession,
  getSessionRoom,
  joinSession,
  updateParticipants,
  getAppointmentById,
  getAppointmentStats,
};
