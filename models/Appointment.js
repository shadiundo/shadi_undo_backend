// models/Appointment.js
import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({
  startedAt: Date,
  endedAt: Date,
  status: {
    type: String,
    enum: ["not_started", "ongoing", "ended"],
    default: "not_started",
  },
  // Holds placed on user's wallet for this session (extensions supported)
  holds: [
    {
      transactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
      amount: Number,
      minutesReserved: Number,
      createdAt: { type: Date, default: Date.now },
      expiresAt: Date,
      settled: { type: Boolean, default: false },
    },
  ],
    // NEW FIELDS (Daily integration)
  roomName: { type: String, index: true },    // daily room name (session_{appointmentId}...) 
  videoRoom: { type: String },                // backward compatibility (you already used)
  recordings: [
    {
      url: String,
      fileName: String,
      size: Number,
      createdAt: { type: Date, default: Date.now }
    }
  ],
  participants: {
    professionalJoined: { type: Boolean, default: false },
    userJoined: { type: Boolean, default: false },
    bothJoinedAt: Date
  },
  expiresAt: Date,
  minEndTime: Date,
});


const priceSnapshotSchema = new mongoose.Schema({
  tier: {
    type: String,
    enum: ["A", "B", "C", "D", "E"],
    required: false,
  },
  role: { type: String }, // "lawyer" | "mediator" | "therapist" | "counsellor"
  ratePer30m: { type: Number, required: true },
  ratePerMinute: { type: Number, required: true },
  description: { type: String }, // optional: e.g. "High Court lawyer / 7–10 yrs"
});

const appointmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  professionalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Professional",
    required: true,
    index: true,
  },

  roleSnapshot: { type: String }, // professional's role at time of booking (lawyer, mediator, etc.)
  scheduledAt: { type: Date, required: true },
  durationMinutesRequested: { type: Number, default: 30 },
  mode: { type: String, enum: ["audio", "video"], default: "audio" },
  status: {
    type: String,
    enum: ["requested", "confirmed", "rejected", "cancelled", "ongoing", "completed", "pending_payment"],
    default: "requested",
  },

  /** Pricing snapshot — frozen at time of booking */
  priceSnapshot: priceSnapshotSchema,

  createdAt: { type: Date, default: Date.now },

  /** Professional’s acceptance / message */
  profResponse: {
    accepted: { type: Boolean },
    message: String,
    respondedAt: Date,
  },

  /** Live session info */
  session: sessionSchema,

  notes: { type: String },
});

export default mongoose.model("Appointment", appointmentSchema);
