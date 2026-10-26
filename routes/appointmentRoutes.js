// routes/appointmentRoutes.js
import express from "express";
import * as appointmentCtrl from "../controllers/appointmentController.js";
import auth from "../middleware/authMiddleware.js";
import { createOrder, verifyPayment, webhookHandler } from "../controllers/paymentController.js";
import { dailyWebhookHandler } from "../controllers/dailyWebhookController.js";   

const { protect, adminOnly, requireProfessionalOrAdminForTarget } = auth;
const router = express.Router();

// appointment creation & basic actions
router.post("/", protect, appointmentCtrl.createAppointment);
router.post("/:id/respond", protect, appointmentCtrl.professionalRespond);
router.post("/:id/start", protect, appointmentCtrl.startAppointment);
router.post("/:id/extend", protect, appointmentCtrl.extendAppointment);
router.post("/:id/end", protect, appointmentCtrl.endAppointment);


// participants & session management
router.post("/:id/participants", protect, appointmentCtrl.updateParticipants);

// Daily call creation (replaces Jitsi)
router.post("/:id/start-session", protect, appointmentCtrl.startRealTimeSession);

// Getting session room info
router.get("/:id/session-room", protect, appointmentCtrl.getSessionRoom);
router.get("/stats", appointmentCtrl.getAppointmentStats);

// routes/appointments.js
router.get("/overview", appointmentCtrl.getRevenueAndBookingsOverview);


// Join Daily call → server returns short-lived Daily token
router.post("/:id/join-session", protect, appointmentCtrl.joinSession);

// Daily Webhook (PUBLIC) — DO NOT PROTECT
// Accept ANY content-type Daily sends
router.post(
  "/integrations/daily/webhook",
  express.raw({ type: "*/*" }),

  dailyWebhookHandler
);

// wallet / payments
router.post("/wallet/topup", protect, createOrder);
router.post("/wallet/topup/verify", protect, verifyPayment);

// Payment provider webhook (also PUBLIC)
router.post("/wallet/topup/webhook", webhookHandler);

// wallet retrieval
router.get("/wallet", protect, appointmentCtrl.getWallet);
router.get("/wallet/transactions", protect, appointmentCtrl.getTransactions);

// admin utilities
router.get("/admin/recent", protect, adminOnly, appointmentCtrl.getRecentAppointments);

// professional view
router.get(
  "/professional/recent",
  protect,
  requireProfessionalOrAdminForTarget,
  appointmentCtrl.getProfessionalRecentAppointments
);

// appointment get by id (keep last)
router.get("/:id", protect, appointmentCtrl.getAppointmentById);

export default router;
