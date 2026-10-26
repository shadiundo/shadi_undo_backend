// scripts/seedAdmin.js
import dotenv from 'dotenv';
import yargs from 'yargs';
import connectDB from '../config/db.js';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';



dotenv.config();

const argv = yargs(process.argv.slice(2))
  .option('email', { type: 'string', default: 'admin@example.com' })
  .option('name', { type: 'string', default: 'Admin' })
  .option('password', { type: 'string', default: 'Admin@1234' })
  .option('expiry', { type: 'string', default: process.env.INIT_ADMIN_TOKEN_EXPIRE || '30d' }) // e.g. '30d'
  .argv;

const seedAdmin = async () => {
  try {
    await connectDB();
    console.log('MongoDB connected');

    let admin = await User.findOne({ email: argv.email.toLowerCase() });

    if (!admin) {
      admin = await User.create({
        name: argv.name,
        email: argv.email.toLowerCase(),
        password: argv.password,
        role: 'admin'
      });
      console.log('✅ Created new admin:', admin.email);
    } else {
      console.log('Admin user already exists:', admin.email);
      // Ensure role is admin
      if (admin.role !== 'admin') {
        admin.role = 'admin';
        await admin.save();
        console.log('Updated role -> admin for', admin.email);
      }
    }

    // Token: use jwt.sign with expiry (default 30d), do NOT issue token with no expiry
    const token = jwt.sign({ id: admin._id.toString(), role: admin.role }, process.env.JWT_SECRET, {
      expiresIn: argv.expiry
    });

    console.log('\nUse this JWT as Authorization: Bearer <token>\n');
    console.log(token, '\n');

    process.exit(0);
  } catch (error) {
    console.error(' Error creating admin:', error);
    process.exit(1);
  }
};

seedAdmin();
