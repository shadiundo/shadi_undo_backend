import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import http from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import Appointment from "./models/Appointment.js";


import connectDB from "./config/db.js";
import professionalRoutes from "./routes/professionalRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import appointmentRoutes from "./routes/appointmentRoutes.js";
import adminsRouter from "./routes/adminRoutes.js";
import userProfileRoutes from "./routes/UserProfileRoutes.js";
import reviewRouter from "./routes/reviewRoutes.js";

dotenv.config();
const app = express();
connectDB();

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// In your Express server (index.js or server.js)
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://*.daily.co https://shaadiundo.daily.co;"
  );
  next();
});


app.set("trust proxy", 1);

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://shaadi-undo.vercel.app",
  "https://shadi-undo-frontend.vercel.app",
  "https://shaadi-undo-kyc5k230h-arman-maliks-projects-7ea1add6.vercel.app",
  "https://shaadiundo.daily.co",
  "https://shaadiundo.com",
  "https://www.shaadiundo.com",
  "https://shadiundo.com",
  "https://www.shadiundo.com"
];

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    if (host.endsWith(".vercel.app")) return true;
    if (host.endsWith("shaadiundo.com") || host.endsWith("shadiundo.com") || host.endsWith("daily.co")) return true;
  } catch {}
  if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) return true;
  // Allow local LAN IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x, localhost)
  if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)) {
    return true;
  }
  return false;
}

app.use(
  cors({
    origin: function (origin, callback) {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Requested-With"
    ]
  })
);

app.use("/api/admins", adminsRouter);
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/professionals", professionalRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/profile", userProfileRoutes);
app.use("/api/reviews", reviewRouter);

app.get("/", (req, res) => res.send("API running"));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (isOriginAllowed(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  },
});
io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  socket.on("join-session", ({ appointmentId, role }) => {
    socket.join(`appointment:${appointmentId}`);
    socket.data.role = role;
    socket.data.appointmentId = appointmentId;
    console.log(`📌 ${role} joined appointment:${appointmentId}`);
  });

  socket.on("user-joined", ({ appointmentId, user }) => {
    socket.to(`appointment:${appointmentId}`).emit("notify", {
      type: "USER_JOINED",
      message: `${user?.name || "User"} joined the session`,
    });
    socket.to(`appointment:${appointmentId}`).emit("user-joined", { appointmentId, user });
  });

  socket.on("user-left", ({ appointmentId, user }) => {
    socket.to(`appointment:${appointmentId}`).emit("notify", {
      type: "USER_LEFT",
      message: `${user?.name || "User"} left the session`,
    });
    socket.to(`appointment:${appointmentId}`).emit("user-left", { appointmentId, user });
  });

  socket.on("professional-left", async ({ appointmentId }) => {
    console.log(`⚠️ Professional left appointment:${appointmentId}`);
    try {
      if (appointmentId && mongoose.Types.ObjectId.isValid(appointmentId)) {
        await Appointment.findByIdAndUpdate(appointmentId, {
          $set: {
            "session.pausedAt": new Date(),
            "session.participants.professionalJoined": false,
          }
        });
      }
    } catch (e) {
      console.warn("Failed to set pausedAt on professional-left:", e);
    }
    socket.to(`appointment:${appointmentId}`).emit("professional-left", { appointmentId });
    socket.to(`appointment:${appointmentId}`).emit("notify", {
      type: "PROFESSIONAL_LEFT",
      message: "Professional has disconnected. Timer is paused.",
    });
  });

  socket.on("professional-joined", async ({ appointmentId }) => {
    console.log(`✅ Professional rejoined appointment:${appointmentId}`);
    try {
      if (appointmentId && mongoose.Types.ObjectId.isValid(appointmentId)) {
        const appt = await Appointment.findById(appointmentId);
        if (appt && appt.session) {
          if (appt.session.pausedAt && appt.session.expiresAt) {
            const pausedMs = Math.max(0, Date.now() - new Date(appt.session.pausedAt).getTime());
            appt.session.expiresAt = new Date(new Date(appt.session.expiresAt).getTime() + pausedMs);
          }
          appt.session.pausedAt = null;
          appt.session.participants = appt.session.participants || {};
          appt.session.participants.professionalJoined = true;
          await appt.save();
        }
      }
    } catch (e) {
      console.warn("Failed to unpause on professional-joined:", e);
    }
    socket.to(`appointment:${appointmentId}`).emit("professional-joined", { appointmentId });
    socket.to(`appointment:${appointmentId}`).emit("notify", {
      type: "PROFESSIONAL_JOINED",
      message: "Professional has rejoined the session.",
    });
  });

  socket.on("disconnect", async () => {
    console.log("❌ Socket disconnected:", socket.id);
    if (socket.data.role === "professional" && socket.data.appointmentId) {
      const apptId = socket.data.appointmentId;
      try {
        if (apptId && mongoose.Types.ObjectId.isValid(apptId)) {
          await Appointment.findByIdAndUpdate(apptId, {
            $set: {
              "session.pausedAt": new Date(),
              "session.participants.professionalJoined": false,
            }
          });
        }
      } catch (e) {
        console.warn("Socket disconnect pause failed:", e);
      }
      socket.to(`appointment:${apptId}`).emit("professional-left", {
        appointmentId: apptId,
      });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});



console.log("DAILY_DOMAIN:", process.env.DAILY_DOMAIN);

console.log("DAILY_API_KEY:", Boolean(process.env.DAILY_API_KEY));

