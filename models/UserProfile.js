// models/userProfile.js
import mongoose from "mongoose";

const UserProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

    name: { type: String },
    email: { type: String, sparse: true },
    phone: { type: String, sparse: true },

    avatarUrl: { type: String },
    bio: { type: String },
    location: { type: String },

    // No appointments array here — appointments are stored in Appointment collection
  },
  { timestamps: true, toObject: { virtuals: true }, toJSON: { virtuals: true } } // enable virtuals in output
);

// text index
UserProfileSchema.index({ name: "text", email: "text", phone: "text" });

// virtual populate for wallet (one-to-one)
UserProfileSchema.virtual("wallet", {
  ref: "Wallet", // model to use
  localField: "user", // find Wallet where `userId` === this.user
  foreignField: "userId",
  justOne: true,
});

// optional virtual populate for recent transactions (not required; controller also queries transactions directly)
UserProfileSchema.virtual("recentTransactions", {
  ref: "Transaction",
  localField: "user",
  foreignField: "userId",
  justOne: false,
  options: { sort: { createdAt: -1 }, limit: 10 },
});

export default mongoose.model("UserProfile", UserProfileSchema);
