// controllers/paymentController.js
import Razorpay from "razorpay";
import crypto from "crypto";
import Wallet from "../models/Wallet.js";
import Transaction from "../models/Transaction.js";

/**
 * Lazily return a Razorpay instance. Throws a clear error if keys missing.
 */
function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    // throw a clear, non-library error so app doesn't crash at import time
    throw new Error(
      "Razorpay keys are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment."
    );
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// helper
const makeOrderRef = () => `order_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

/**
 * Create order (protected)
 */
export const createOrder = async (req, res) => {
  try {
    // ensure keys present (getRazorpay will throw if not)
    const razorpay = getRazorpay();

    const userId = req.user && (req.user._id ?? req.user.id);
    if (!userId) return res.status(401).json({ success: false, message: "Auth required" });

    let { amount } = req.body;
    amount = Number(amount);
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: "Invalid amount" });

    const amountPaise = Math.round(amount * 100);
    const receipt = makeOrderRef();

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt,
      payment_capture: 1,
    });

    await Transaction.create({
      walletId: null,
      userId,
      type: "topup_initiated",
      amount,
      reference: order.id,
      meta: { receipt },
      status: "pending",
    });

    return res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        receipt,
      },
    });
  } catch (err) {
   
    console.error("createOrder error:", err);
    if (/Razorpay keys are not configured/.test(err.message)) {
      return res.status(500).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }


};


export const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({ success: false, message: "RAZORPAY_KEY_SECRET not configured" });
    }

    const generated_signature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generated_signature !== razorpay_signature) {
      console.warn("Razorpay signature mismatch", { generated_signature, razorpay_signature });
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    const pending = await Transaction.findOne({ reference: razorpay_order_id });
    if (!pending) return res.status(404).json({ success: false, message: "Order not found" });
    if (pending.status === "success") return res.json({ success: true, message: "Already processed" });

    pending.status = "success";
    pending.meta = { ...pending.meta, razorpay_payment_id, verifiedAt: new Date() };
    await pending.save();

    const wallet = await Wallet.getOrCreate(pending.userId);
    wallet.balance = Number(((wallet.balance || 0) + Number(pending.amount)).toFixed(6));
    await wallet.save();

    await Transaction.create({
      walletId: wallet._id,
      userId: pending.userId,
      type: "credit",
      amount: pending.amount,
      reference: razorpay_payment_id,
      meta: { via: "razorpay", order: razorpay_order_id },
      status: "success",
    });

    return res.json({ success: true, message: "Payment verified and wallet topped up", amount: pending.amount });
  } catch (err) {
    console.error("verifyPayment error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Webhook handler (public). Expects raw body to be attached on req.rawBody by middleware.
 */
export const webhookHandler = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];
    const bodyRaw = req.rawBody || JSON.stringify(req.body || {});

    if (!webhookSecret) {
      console.warn("Webhook secret not configured");
      return res.status(400).end();
    }
    if (!signature) {
      console.warn("Missing signature");
      return res.status(400).end();
    }

    const expected = crypto.createHmac("sha256", webhookSecret).update(bodyRaw).digest("hex");
    if (expected !== signature) {
      console.warn("Webhook signature mismatch", { expected, signature });
      return res.status(400).end();
    }

    const event = req.body;
    const eventType = event.event;

    if (eventType === "payment.captured" || eventType === "order.paid") {
      const payment = event.payload?.payment?.entity || {};
      const razorpay_order_id = payment.order_id;
      const razorpay_payment_id = payment.id;
      const pending = await Transaction.findOne({ reference: razorpay_order_id });
      if (pending && pending.status !== "success") {
        pending.status = "success";
        pending.meta = { ...pending.meta, razorpay_webhook: event, razorpay_payment_id };
        await pending.save();

        const wallet = await Wallet.getOrCreate(pending.userId);
        wallet.balance = Number(((wallet.balance || 0) + Number(pending.amount)).toFixed(6));
        await wallet.save();

        await Transaction.create({
          walletId: wallet._id,
          userId: pending.userId,
          type: "credit",
          amount: pending.amount,
          reference: razorpay_payment_id,
          meta: { via: "razorpay", order: razorpay_order_id, webhook_event: eventType },
          status: "success",
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("webhook error:", err);
    return res.status(500).end();
  }
};
