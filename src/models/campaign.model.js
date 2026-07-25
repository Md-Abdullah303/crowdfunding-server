import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Campaign title is required"],
      trim: true,
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Campaign description is required"],
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: [
        "technology",
        "arts",
        "health",
        "education",
        "environment",
        "community",
        "business",
        "other",
      ],
    },
    coverImage: {
      type: String,
      required: [true, "Cover image is required"],
    },
    goalAmount: {
      type: Number,
      required: [true, "Goal amount is required"],
      min: [200, "Minimum goal is 200 credits"],
    },
    raisedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    deadline: {
      type: Date,
      required: [true, "Deadline is required"],
    },
    // status: pending | approved | rejected | completed
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "completed"],
      default: "pending",
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    isReported: {
      type: Boolean,
      default: false,
    },
    reportReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const Campaign = mongoose.model("Campaign", campaignSchema);
export default Campaign;
