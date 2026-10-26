// routes/admins.js
import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();


router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'name, email and password are required' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'User with that email already exists' });
    }

    const user = await User.create({ name, email: email.toLowerCase(), password, role: 'admin' });
    const safeUser = { _id: user._id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
    return res.status(201).json({ success: true, user: safeUser });
  } catch (err) {
    console.error('POST /api/admins error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});


router.post('/init', async (req, res) => {
  try {
    const { name, email, password, initSecret } = req.body;
    const configuredSecret = process.env.INIT_ADMIN_SECRET;
    if (!configuredSecret) {
      return res.status(403).json({ success: false, message: 'INIT_ADMIN_SECRET not configured on server' });
    }
    if (!initSecret || initSecret !== configuredSecret) {
      return res.status(401).json({ success: false, message: 'Invalid init secret' });
    }

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'name, email and password are required' });
    }

    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      return res.status(409).json({ success: false, message: 'An admin already exists. Use protected endpoint to create more.' });
    }

    const user = await User.create({ name, email: email.toLowerCase(), password, role: 'admin' });
    const safeUser = { _id: user._id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };

    // Issue a token (short/medium expiry by default)
    const tokenExpiry = process.env.INIT_ADMIN_TOKEN_EXPIRE || '30d';
    const token = jwt.sign({ id: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
      expiresIn: tokenExpiry
    });

    return res.status(201).json({ success: true, user: safeUser, token });
  } catch (err) {
    console.error('POST /api/admins/init error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
