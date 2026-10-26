// fixIndexes.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./models/User.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/testdb";

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB:", MONGO_URI);

  const col = User.collection;

  console.log("\nCurrent indexes:");
  const indexesBefore = await col.getIndexes({ full: true });
  console.log(indexesBefore);

  // Attempt to drop indexes named "email_1" and "phone_1" if they exist.
  // Index names may differ; list above to confirm names.
  const maybeDrop = async (name) => {
    try {
      await col.dropIndex(name);
      console.log(`Dropped index: ${name}`);
    } catch (e) {
      console.log(`Could not drop index ${name}:`, e.message);
    }
  };

  await maybeDrop("email_1");
  await maybeDrop("phone_1");

  // Recreate partial unique indexes:
  try {
    await col.createIndex(
      { email: 1 },
      {
        unique: true,
        partialFilterExpression: { email: { $exists: true, $ne: null } },
      }
    );
    console.log("Created partial unique index on email");
  } catch (e) {
    console.error("Error creating email index:", e.message);
  }

  try {
    await col.createIndex(
      { phone: 1 },
      {
        unique: true,
        partialFilterExpression: { phone: { $exists: true, $ne: null } },
      }
    );
    console.log("Created partial unique index on phone");
  } catch (e) {
    console.error("Error creating phone index:", e.message);
  }

  console.log("\nIndexes after changes:");
  const indexesAfter = await col.getIndexes({ full: true });
  console.log(indexesAfter);

  await mongoose.disconnect();
  console.log("Disconnected.");
}

run().catch((err) => {
  console.error("fixIndexes error:", err);
  process.exit(1);
});
