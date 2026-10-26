// models/Transaction.js
import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
  walletId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Wallet",
    required: false,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  type: {
    type: String,
    enum: [
      "credit",
      "debit",
      "hold",
      "release",
      "settlement",

      // Added for wallet topups
      "topup_initiated",
      "topup_failed",
      "topup_refunded"
    ],
    required: true,
  },
  amount: { type: Number, required: true },
  reference: { type: String }, // orderId or paymentId
  status: {
    type: String,
    enum: ["pending", "success", "failed"],
    default: "success",
  },
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Transaction", transactionSchema);
