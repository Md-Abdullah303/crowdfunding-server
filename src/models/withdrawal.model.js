import mongoose from "mongoose";

// Exchange rate: 20 credits = $1 USD
const CREDITS_PER_DOLLAR = 20;

const withdrawalSchema = new mongoose.Schema(
  {
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    // Amount requested in credits (min: 200 credits = $10)
    amountCredits: {
      type: Number,
      required: [true, "Withdrawal amount is required"],
      min: [200, "Minimum withdrawal is 200 credits ($10)"],
    },
    // Auto-calculated USD amount
    amountUSD: {
      type: Number,
    },
    // status: pending | approved | rejected
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    // Payment info provided by admin
    paymentMethod: {
      type: String,
      default: null,
    },
    note: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-calculate USD before saving
withdrawalSchema.pre("save", function (next) {
  this.amountUSD = this.amountCredits / CREDITS_PER_DOLLAR;
  next();
});

const Withdrawal = mongoose.model("Withdrawal", withdrawalSchema);
export default Withdrawal;
