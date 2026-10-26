import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      unique: true, // one review per appointment
    },
    professionalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Professional",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,

    // ✅ IMPORTANT: allow virtuals in responses
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* =========================
   INDEXES
========================= */

// one review per appointment
reviewSchema.index({ appointmentId: 1 }, { unique: true });

// faster lookups
reviewSchema.index({ professionalId: 1 });
reviewSchema.index({ userId: 1 });

// optional safety (user cannot review same professional twice for same appointment)
reviewSchema.index(
  { appointmentId: 1, userId: 1 },
  { unique: true }
);

/* =========================
   VIRTUALS
========================= */

// ✅ frontend-friendly id
reviewSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

export default mongoose.model("Review", reviewSchema);
