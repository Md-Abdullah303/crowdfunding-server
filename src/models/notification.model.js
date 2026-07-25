import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    // The user who should see this notification
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    // Notification types
    type: {
      type: String,
      enum: [
        "contribution_received",   // Creator gets this when someone contributes
        "contribution_approved",   // Supporter gets this when creator approves
        "contribution_rejected",   // Supporter gets this when creator rejects
        "campaign_approved",       // Creator gets this when admin approves campaign
        "campaign_rejected",       // Creator gets this when admin rejects campaign
        "withdrawal_approved",     // Creator gets this when admin approves withdrawal
      ],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    // Reference to related document for linking
    refModel: {
      type: String,
      enum: ["Campaign", "Contribution", "Withdrawal"],
      default: null,
    },
    refId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
