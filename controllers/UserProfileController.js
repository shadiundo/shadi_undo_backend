import UserProfile from "../models/UserProfile.js";
import User from "../models/User.js";
import Appointment from "../models/Appointment.js";
import Wallet from "../models/Wallet.js";
import Transaction from "../models/Transaction.js";
import mongoose from "mongoose";
import Review from "../models/Review.js";


/**
 * Helper: map appointment doc to client-friendly object
 */
const mapAppointment = (a) => ({
  _id: a._id,
  scheduledAt: a.scheduledAt,
  durationMinutesRequested: a.durationMinutesRequested,
  mode: a.mode,
  status: a.status,
  roleSnapshot: a.roleSnapshot,
  notes: a.notes,
  priceSnapshot: a.priceSnapshot,
  profResponse: a.profResponse,
  session: a.session,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  professional: a.professionalId
    ? {
        _id: a.professionalId._id,
        name: a.professionalId.name,
        email: a.professionalId.email,
        role: a.professionalId.role,
      }
    : null,
});

/* ------------------------ ID / ObjectId helpers ------------------------ */

/**
 * Safely convert input to a mongoose ObjectId instance.
 * - returns an instance of mongoose.Types.ObjectId when input is valid
 * - returns null when input is falsy or invalid
 */
const toObjectId = (id) => {
  if (!id) return null;
  // already an ObjectId instance
  if (id instanceof mongoose.Types.ObjectId) return id;
  // strings / numbers that are valid
  if (mongoose.isValidObjectId(id)) return new mongoose.Types.ObjectId(String(id));
  return null;
};

/* ------------------------- Transaction & Wallet helpers ------------------------- */

/**
 * Aggregate unsettled holds for a user (all transactions).
 * We treat transactions with:
 *   type: "hold", status: "success", and meta.settled !== true
 * as reserved amounts.
 *
 * Returns a Number (0 if none).
 */
const getReservedAmountForUser = async (userId) => {
  const oid = toObjectId(userId);
  if (!oid) return 0;

  const pipeline = [
    {
      $match: {
        userId: oid,
        type: "hold",
        status: "success",
        $or: [{ "meta.settled": { $exists: false } }, { "meta.settled": { $ne: true } }],
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ];

  const res = await Transaction.aggregate(pipeline);
  return res && res[0] && res[0].total ? Number(res[0].total) : 0;
};

/**
 * Sum unsettled holds from an array of transaction docs (fallback)
 */
const sumUnsettledHoldsFromTransactions = (transactions = []) => {
  let sum = 0;
  for (const t of transactions) {
    if (!t) continue;
    if (t.type === "hold" && t.status === "success" && !(t.meta && t.meta.settled === true)) {
      sum += Number(t.amount || 0);
    }
  }
  return sum;
};

/**
 * Query recent transactions for a user (paginated).
 * Returns [transactionsArray, totalCount]
 */
const listRecentTransactions = async (userId, { page = 1, limit = 10 } = {}) => {
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const skip = (p - 1) * l;

  // Mongoose will cast string _id to ObjectId for queries, but it's safe to pass userId directly.
  const [transactions, total] = await Promise.all([
    Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(l)
      .lean(),
    Transaction.countDocuments({ userId }),
  ]);

  return [transactions, total];
};

/* ---------------- GET current user's profile (with appointments + wallet + recent transactions) ---------------- */
export const getMyProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    // fetch profile
    const profile = await UserProfile.findOne({ user: userId }).populate("user", "name email phone role").lean();
    if (!profile) return res.status(404).json({ success: false, message: "Profile not found" });

    // appointments pagination
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const skip = (page - 1) * limit;

    const [appointments, appointmentsTotal] = await Promise.all([
      Appointment.find({ userId })
        .sort({ scheduledAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: "professionalId", select: "name email role" })
        .lean(),
      Appointment.countDocuments({ userId }),
    ]);

    // 1️⃣ map appointments
const mappedAppointments = appointments.map(mapAppointment);

// 2️⃣ collect appointment IDs
const appointmentIds = mappedAppointments.map(a => a._id);

// 3️⃣ fetch reviews for these appointments
const reviews = await Review.find({
  appointmentId: { $in: appointmentIds },
})
  .select("appointmentId rating comment createdAt")
  .lean();

// 4️⃣ build lookup map
const reviewMap = new Map();
for (const r of reviews) {
  reviewMap.set(String(r.appointmentId), r);
}

// 5️⃣ attach review to appointment
profile.appointments = mappedAppointments.map(a => ({
  ...a,
  review: reviewMap.get(String(a._id)) || null,
}));


    // transactions pagination for recent transactions
    const txPage = Math.max(parseInt(req.query.txPage || "1", 10), 1);
    const txLimit = Math.min(Math.max(parseInt(req.query.txLimit || "10", 10), 1), 100);
    const [recentTransactions, txTotal] = await listRecentTransactions(userId, { page: txPage, limit: txLimit });

    // compute reserved amount across ALL transactions (accurate)
    let reservedAmount = 0;
    try {
      reservedAmount = await getReservedAmountForUser(userId);
    } catch (aggErr) {
      console.warn("[getMyProfile] reservedAmount aggregation failed, falling back to recent txs", aggErr?.message || aggErr);
      reservedAmount = sumUnsettledHoldsFromTransactions(recentTransactions);
    }

    // attach wallet snapshot: create-or-get for owner; return raw wallet doc (lean) plus computed fields
    try {
      // Use getOrCreate to ensure owner always has a wallet doc
      const walletDoc = await Wallet.getOrCreate(userId); // returns Mongoose doc
      // Convert to plain object and fetch up-to-date lean doc (so structure matches DB)
      const wallet = await Wallet.findOne({ userId }).lean();

      if (wallet) {
        const balance = Number(wallet.balance || 0);
        const available = balance - reservedAmount;
        // attach DB-like fields plus computed
        wallet.reservedAmount = reservedAmount;
        wallet.availableBalance = available < 0 ? 0 : available;
        profile.wallet = wallet;
      } else {
        profile.wallet = null;
      }
    } catch (wErr) {
      console.warn("[getMyProfile] wallet fetch/create failed", wErr?.message || wErr);
      profile.wallet = null;
    }

    // attach recent transactions (safe subset)
    profile.recentTransactions = recentTransactions.map((t) => ({
      _id: t._id,
      type: t.type,
      amount: t.amount,
      reference: t.reference,
      status: t.status,
      meta: t.meta,
      createdAt: t.createdAt,
    }));

    return res.json({
      success: true,
      data: profile,
      meta: {
        appointmentsCount: appointmentsTotal,
        page,
        limit,
        transactionsCount: txTotal,
        txPage,
        txLimit,
      },
    });
  } catch (err) {
    console.error("[getMyProfile]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------- GET only appointments (read-only, paginated) ---------------- */
export const getMyAppointments = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const skip = (page - 1) * limit;

    const [appointments, total] = await Promise.all([
      Appointment.find({ userId })
        .sort({ scheduledAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: "professionalId", select: "name email role" })
        .lean(),
      Appointment.countDocuments({ userId }),
    ]);

    return res.json({
      success: true,
      data: appointments.map(mapAppointment),
      meta: {
        appointmentsCount: total,
        page,
        limit,
      },
    });
  } catch (err) {
    console.error("[getMyAppointments]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------- Create or update profile (upsert) ---------------- */
export const createOrUpdateProfile = async (req, res) => {
  try {
    const { name, email, phone, avatarUrl, bio, location } = req.body;
    const profileFields = {
      user: req.user._id,
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(bio ? { bio } : {}),
      ...(location ? { location } : {}),
    };

    const profileDoc = await UserProfile.findOneAndUpdate(
      { user: req.user._id },
      { $set: profileFields },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).populate("user", "name email phone");

    // optionally sync User doc
    const userUpdates = {};
    if (name) userUpdates.name = name;
    if (email) userUpdates.email = email;
    if (phone) userUpdates.phone = phone;
    if (Object.keys(userUpdates).length) {
      try {
        await User.findByIdAndUpdate(req.user._id, { $set: userUpdates }, { new: true });
      } catch (syncErr) {
        console.warn("[createOrUpdateProfile] user sync failed", syncErr?.message || syncErr);
      }
    }

    // attach wallet snapshot for owner (create-or-get)
    let profileObj = profileDoc.toObject ? profileDoc.toObject() : profileDoc;
    try {
      const [recentTransactions, txTotal] = await listRecentTransactions(req.user._id, { page: 1, limit: 10 });
      const reservedAmount = await getReservedAmountForUser(req.user._id);

      // fetch wallet as lean doc to show DB-like fields
      const wallet = await Wallet.findOne({ userId: req.user._id }).lean();
      if (wallet) {
        const balance = Number(wallet.balance || 0);
        const available = balance - reservedAmount;
        wallet.reservedAmount = reservedAmount;
        wallet.availableBalance = available < 0 ? 0 : available;
        profileObj.wallet = wallet;
      } else {
        // ensure a wallet exists for owner
        const created = await Wallet.getOrCreate(req.user._id);
        const fresh = await Wallet.findOne({ userId: req.user._id }).lean();
        const balance = Number(fresh.balance || 0);
        const available = balance - reservedAmount;
        fresh.reservedAmount = reservedAmount;
        fresh.availableBalance = available < 0 ? 0 : available;
        profileObj.wallet = fresh;
      }

      profileObj.recentTransactions = recentTransactions.map((t) => ({
        _id: t._id,
        type: t.type,
        amount: t.amount,
        reference: t.reference,
        status: t.status,
        meta: t.meta,
        createdAt: t.createdAt,
      }));
    } catch (wErr) {
      console.warn("[createOrUpdateProfile] wallet/tx fetch failed", wErr?.message || wErr);
      profileObj.wallet = null;
      profileObj.recentTransactions = [];
    }

    return res.json({ success: true, data: profileObj });
  } catch (err) {
    console.error("[createOrUpdateProfile]", err);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Duplicate value", error: err.keyValue });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------- Update profile partial ---------------- */
export const updateMyProfile = async (req, res) => {
  try {
    const updates = req.body;
    const profileDoc = await UserProfile.findOneAndUpdate({ user: req.user._id }, { $set: updates }, { new: true });
    if (!profileDoc) return res.status(404).json({ success: false, message: "Profile not found" });

    // sync User doc if needed
    const userSync = {};
    if (updates.name) userSync.name = updates.name;
    if (updates.email) userSync.email = updates.email;
    if (updates.phone) userSync.phone = updates.phone;
    if (Object.keys(userSync).length) {
      try {
        await User.findByIdAndUpdate(req.user._id, { $set: userSync }, { new: true });
      } catch (syncErr) {
        console.warn("[updateMyProfile] user sync failed", syncErr?.message || syncErr);
      }
    }

    // attach wallet snapshot for owner (create-or-get)
    let profileObj = profileDoc.toObject ? profileDoc.toObject() : profileDoc;
    try {
      const [recentTransactions, txTotal] = await listRecentTransactions(req.user._id, { page: 1, limit: 10 });
      const reservedAmount = await getReservedAmountForUser(req.user._id);

      const wallet = await Wallet.findOne({ userId: req.user._id }).lean();
      if (wallet) {
        const balance = Number(wallet.balance || 0);
        const available = balance - reservedAmount;
        wallet.reservedAmount = reservedAmount;
        wallet.availableBalance = available < 0 ? 0 : available;
        profileObj.wallet = wallet;
      } else {
        const created = await Wallet.getOrCreate(req.user._id);
        const fresh = await Wallet.findOne({ userId: req.user._id }).lean();
        const balance = Number(fresh.balance || 0);
        const available = balance - reservedAmount;
        fresh.reservedAmount = reservedAmount;
        fresh.availableBalance = available < 0 ? 0 : available;
        profileObj.wallet = fresh;
      }

      profileObj.recentTransactions = recentTransactions.map((t) => ({
        _id: t._id,
        type: t.type,
        amount: t.amount,
        reference: t.reference,
        status: t.status,
        meta: t.meta,
        createdAt: t.createdAt,
      }));
    } catch (wErr) {
      console.warn("[updateMyProfile] wallet/tx fetch failed", wErr?.message || wErr);
      profileObj.wallet = null;
      profileObj.recentTransactions = [];
    }

    return res.json({ success: true, data: profileObj });
  } catch (err) {
    console.error("[updateMyProfile]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------- Delete my profile ---------------- */
export const deleteMyProfile = async (req, res) => {
  try {
    await UserProfile.findOneAndDelete({ user: req.user._id });
    return res.json({ success: true, message: "Profile deleted" });
  } catch (err) {
    console.error("[deleteMyProfile]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------- Remove appointment by id (admin/pro only) ---------------- */
export const removeAppointment = async (req, res) => {
  try {
    const { aptId } = req.params;
    const appointment = await Appointment.findById(aptId);
    if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found" });

    await appointment.remove();
    return res.json({ success: true, message: "Appointment removed" });
  } catch (err) {
    console.error("[removeAppointment]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------- Update appointment status (professional/admin) ---------------- */
export const updateAppointmentStatus = async (req, res) => {
  try {
    const { userId, aptId } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: "status is required" });

    const appointment = await Appointment.findById(aptId);
    if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found" });

    if (String(appointment.userId) !== String(userId)) {
      return res.status(400).json({ success: false, message: "Appointment does not belong to userId" });
    }

    appointment.status = status;
    await appointment.save();

    const populated = await Appointment.findById(aptId).populate({ path: "professionalId", select: "name email role" }).lean();
    return res.json({ success: true, data: mapAppointment(populated) });
  } catch (err) {
    console.error("[updateAppointmentStatus]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------- Get public/profile by user id (owner or admin) ---------------- */
export const getProfileByUserId = async (req, res) => {
  try {
    const targetId = req.params.id;

    const isOwner = String(req.user._id) === String(targetId);
    if (!isOwner) {
      const role = String(req.user.role || "").toLowerCase();
      if (role !== "admin") {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const profile = await UserProfile.findOne({ user: targetId }).populate("user", "name email phone role").lean();
    if (!profile) return res.status(404).json({ success: false, message: "Profile not found" });

    const appointments = await Appointment.find({ userId: targetId })
      .sort({ scheduledAt: -1 })
      .populate({ path: "professionalId", select: "name email role" })
      .lean();

    profile.appointments = appointments.map(mapAppointment);

    // Attach wallet: if requester is owner -> create-or-get, if admin -> read-only (no auto-create)
    try {
      const txPage = Math.max(parseInt(req.query.txPage || "1", 10), 1);
      const txLimit = Math.min(Math.max(parseInt(req.query.txLimit || "10", 10), 1), 100);
      const [recentTransactions, txTotal] = await listRecentTransactions(targetId, { page: txPage, limit: txLimit });

      // compute reserved amount across ALL transactions (accurate)
      let reservedAmount = 0;
      try {
        reservedAmount = await getReservedAmountForUser(targetId);
      } catch (aggErr) {
        console.warn("[getProfileByUserId] reservedAmount aggregation failed, falling back to recent txs", aggErr?.message || aggErr);
        reservedAmount = sumUnsettledHoldsFromTransactions(recentTransactions);
      }

      let wallet = null;
      if (isOwner) {
        // ensure owner's wallet exists, then fetch as lean doc
        await Wallet.getOrCreate(targetId);
        wallet = await Wallet.findOne({ userId: targetId }).lean();
      } else {
        wallet = await Wallet.findOne({ userId: targetId }).lean();
      }

      if (wallet) {
        const balance = Number(wallet.balance || 0);
        const available = balance - reservedAmount;
        wallet.reservedAmount = reservedAmount;
        wallet.availableBalance = available < 0 ? 0 : available;
        profile.wallet = wallet;
      } else {
        profile.wallet = null;
      }

      profile.recentTransactions = recentTransactions.map((t) => ({
        _id: t._id,
        type: t.type,
        amount: t.amount,
        reference: t.reference,
        status: t.status,
        meta: t.meta,
        createdAt: t.createdAt,
      }));

      profile._txMeta = {
        transactionsCount: txTotal,
        txPage,
        txLimit,
      };
    } catch (wErr) {
      console.warn("[getProfileByUserId] wallet/tx fetch failed", wErr?.message || wErr);
      profile.wallet = null;
      profile.recentTransactions = [];
    }

    return res.json({ success: true, data: profile });
  } catch (err) {
    console.error("[getProfileByUserId]", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ---------------- Sign out (clear cookie-based token) ---------------- */
export const signOut = (req, res) => {
  res.cookie("token", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  return res.json({ success: true, message: "Signed out" });
};
