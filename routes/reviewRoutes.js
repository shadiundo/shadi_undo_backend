import express from "express";
import { getReviews, submitReview } from "../controllers/reviewController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", protect, submitReview);

router.get("/", getReviews);
export default router;
