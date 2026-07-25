import mongoose from "mongoose";

const contributionSchema = new mongoose.Schema(
  {
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    supporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    // Amount in credits
    amount: {
      type: Number,
      required: [true, "Contribution amount is required"],
      min: [1, "Minimum contribution is 1 credit"],
    },
    // status: pending | approved | rejected | refunded
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "refunded"],
      default: "pending",
    },
    message: {
      type: String,
      default: null,
      maxlength: [300, "Message cannot exceed 300 characters"],
    },
  },
  {
    timestamps: true,
  }
);

const Contribution = mongoose.model("Contribution", contributionSchema);
export default Contribution;
