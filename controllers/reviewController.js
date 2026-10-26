import Review from "../models/Review.js";
import Appointment from "../models/Appointment.js";
import Professional from "../models/Professional.js";

export const submitReview = async (req, res) => {
  try {
    const userId = req.user._id; // ✅ FIXED

    const { appointmentId, rating, comment } = req.body;

    if (!appointmentId || !rating) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      userId,
      status: "completed",
    });

    if (!appointment) {
      return res.status(403).json({
        success: false,
        message: "Appointment not eligible for review",
      });
    }

    const professionalId = appointment.professionalId;

    const exists = await Review.findOne({ appointmentId });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Review already submitted",
      });
    }

    const review = await Review.create({
      appointmentId,
      professionalId,
      userId,
      rating,
      comment,
    });

    const stats = await Review.aggregate([
      { $match: { professionalId } },
      {
        $group: {
          _id: "$professionalId",
          avg: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ]);

    if (stats.length) {
      await Professional.findByIdAndUpdate(professionalId, {
        averageRating: Number(stats[0].avg.toFixed(1)),
        totalReviews: stats[0].count,
      });
    }

    return res.json({ success: true, data: review });
  } catch (err) {
    console.error("submitReview error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const getReviews = async (req, res) => {
  try {
    const { professionalId, appointmentId } = req.query;

    const filter = {};
    if (professionalId) filter.professionalId = professionalId;
    if (appointmentId) filter.appointmentId = appointmentId;

    if (!professionalId && !appointmentId) {
      return res.status(400).json({
        success: false,
        message: "professionalId or appointmentId is required",
      });
    }

    const reviews = await Review.find(filter)
      .populate("userId", "name") // 👈 show reviewer name
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (err) {
    console.error("getReviews error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};