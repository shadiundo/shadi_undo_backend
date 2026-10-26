import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import http from "http";
import { Server } from "socket.io";


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
  "https://shaadi-undo-kyc5k230h-arman-maliks-projects-7ea1add6.vercel.app",
  "https://shaadiundo.daily.co"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
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
    origin: allowedOrigins,
    credentials: true,
  },
});
io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  socket.on("join-session", ({ appointmentId, role }) => {
    socket.join(`appointment:${appointmentId}`);
    socket.data.role = role;
    console.log(`📌 ${role} joined appointment:${appointmentId}`);
  });

  socket.on("user-joined", ({ appointmentId, user }) => {
    socket.to(`appointment:${appointmentId}`).emit("notify", {
      type: "USER_JOINED",
      message: `${user.name} joined the session`,
    });
  });

  socket.on("user-left", ({ appointmentId, user }) => {
    socket.to(`appointment:${appointmentId}`).emit("notify", {
      type: "USER_LEFT",
      message: `${user.name} left the session`,
    });
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

server.listen(5000, "0.0.0.0", () => {
  console.log("🚀 Server running on port 5000");
});



console.log("DAILY_DOMAIN:", process.env.DAILY_DOMAIN);

console.log("DAILY_API_KEY:", Boolean(process.env.DAILY_API_KEY));

