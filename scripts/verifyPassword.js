// scripts/verifyPassword.js
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';

dotenv.config();

async function main() {
  await connectDB();
  const email = process.argv[2];    // e.g. "shaadiundo@gmail.com"
  const candidate = process.argv[3]; // e.g. "shaadi@123"
  if (!email || !candidate) {
    console.error('Usage: node ./scripts/verifyPassword.js <email> <password>');
    process.exit(2);
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    console.error('User not found:', email);
    process.exit(1);
  }

  const match = await bcrypt.compare(candidate, user.password);
  console.log(`Password match for ${email}:`, match);
  process.exit(match ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
