// models/Wallet.js
import mongoose from "mongoose";

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  balance: { type: Number, default: 0 }, // store as rupees or paise depending on your preference
  currency: { type: String, default: "INR" },
  createdAt: { type: Date, default: Date.now },
});

walletSchema.statics.getOrCreate = async function (userId) {
  let w = await this.findOne({ userId });
  if (!w) {
    w = await this.create({ userId, balance: 0 });
  }
  return w;
};

export default mongoose.model("Wallet", walletSchema);
