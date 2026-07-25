import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    image: {
      type: String,
      default: null,
    },
    // role: supporter | creator | admin
    role: {
      type: String,
      enum: ["supporter", "creator", "admin"],
      default: "supporter",
    },
    // Platform credits (20 credits = $1)
    credits: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Track if registration bonus has been given
    bonusGranted: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("user", userSchema);
export default User;
