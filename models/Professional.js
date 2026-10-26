
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";


const certificateSchema = new mongoose.Schema({
  title: { type: String, required: true },
  issuedBy: { type: String, required: true },
  year: { type: Number },
  fileUrl: { type: String }
});

const educationSchema = new mongoose.Schema({
  degree: { type: String, required: true },
  institution: { type: String, required: true },
  year: { type: Number },
  fileUrl: { type: String }
});

const experienceSchema = new mongoose.Schema({
  firm: { type: String, required: true },
  role: { type: String, required: true },
  years: { type: Number, required: true },
  description: { type: String }
});

const documentSchema = new mongoose.Schema({
  type: { type: String, required: true },
  fileUrl: { type: String, required: true }
});

const additionalDocumentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  fileUrl: { type: String },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  assignedAt: { type: Date, default: Date.now }
});

const locationSchema = new mongoose.Schema({
  country: { type: String, required: true },
  state: { type: String, required: true },
  city: { type: String, required: true },
  locality: { type: String } // for finer distinction (e.g., Delhi High Court vs. Noida)
});


const rateOptionSchema = new mongoose.Schema({
  tier: {
    type: String,
    enum: ["A", "B", "C", "D", "E"],
    required: true
  },
  ratePer30m: { type: Number, required: true }, 
  description: { type: String },
});


const availabilitySchema = new mongoose.Schema({
  dayOfWeek: {
    type: String,
    enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  },
  slots: {
    type: [
      {
        startTime: String,
        endTime: String,
        mode: { type: String, enum: ["audio", "video"], default: "audio" },
      },
    ],
    default: [],
  },
});


/* ---- Professional Schema ---- */
const professionalSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["mediator", "lawyer", "counsellor", "therapist"],
    required: true
  },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String },
  password: { type: String, required: true },
   profilePhoto: { type: String },
  overview: { type: String },
  languages: [{ type: String }],

  location: locationSchema,
  education: [educationSchema],
  specialties: [{ type: String }],
  certificates: [certificateSchema],
  experience: [experienceSchema],
  documents: [documentSchema],
  additionalDocuments: [additionalDocumentSchema],
    availability: [availabilitySchema],
    /* ---- Lawyer-specific ---- */
enrollmentNumber: {
  type: String,
  trim: true,
},

/* ---- Profile Progress ---- */
profileCompletion: {
  type: Number,
  default: 0,
  min: 0,
  max: 100,
},

profileStage: {
  type: String,
  enum: ["signup", "incomplete", "completed"],
  default: "signup",
},


  resetPasswordToken: String,
  resetPasswordExpire: Date,

  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },
  rejectionReason: { type: String },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reviewedAt: { type: Date },

/* ---- Reviews Summary ---- */
  averageRating: {
  type: Number,
  default: 0,
},
totalReviews: {
  type: Number,
  default: 0,
},


  /* ---- Experience ---- */
  yearsExperience: { type: Number, default: 0 },

  /* ---- Flexible Rate Options ---- */
  rateOptions: [rateOptionSchema], // up to 4 options (A–D)
  defaultRate: { type: Number, default: 2000 }, // fallback rate
  ratePerMinute: { type: Number, default: 0 },

  /* ---- Instant Booking ---- */
  isInstantAvailable: { type: Boolean, default: false },
  minInstantMinutes: { type: Number, default: 30 },
  maxInstantMinutes: { type: Number, default: 120 },

  createdAt: { type: Date, default: Date.now }
});



/* ---- Pre-save Hook ---- */
professionalSchema.pre("save", async function (next) {
  try {
    // Hash password if modified
    if (this.isModified("password")) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }

    // Calculate per-minute rate (based on defaultRate)
    if (this.defaultRate != null && (this.isModified("defaultRate") || !this.ratePerMinute)) {
      this.ratePerMinute = this.defaultRate / 30;
    }

    // Validate instant booking settings
    if (this.minInstantMinutes < 5) this.minInstantMinutes = 5;
    if (this.maxInstantMinutes < this.minInstantMinutes)
      this.maxInstantMinutes = Math.max(60, this.minInstantMinutes);

    next();
  } catch (err) {
    next(err);
  }
});


professionalSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

professionalSchema.methods.getSignedJwtToken = function () {
  const options = {};
  if (process.env.JWT_EXPIRE) options.expiresIn = process.env.JWT_EXPIRE;
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET, options);
};


export default mongoose.model("Professional", professionalSchema);
