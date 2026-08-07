import express from "express";
import cors from "cors";
import "dotenv/config";
import mongoose from "mongoose";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { bearer } from "better-auth/plugins";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import Stripe from "stripe";

// ==========================================
// 1. Mongoose Models
// ==========================================

// User Model
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },
    email: { type: String, required: [true, "Email is required"], unique: true, lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    image: { type: String, default: null },
    role: { type: String, enum: ["supporter", "creator", "admin"], default: "supporter" },
    credits: { type: Number, default: 0, min: 0 },
    bonusGranted: { type: Boolean, default: false },
  },
  { timestamps: true }
);
const User = mongoose.model("user", userSchema);

// Campaign Model
const campaignSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, "Campaign title is required"], trim: true, maxlength: 100 },
    description: { type: String, required: [true, "Campaign description is required"] },
    category: { type: String, required: true, enum: ["technology", "arts", "health", "education", "environment", "community", "business", "other"] },
    coverImage: { type: String, required: [true, "Cover image is required"] },
    goalAmount: { type: Number, required: [true, "Goal amount is required"], min: 200 },
    raisedAmount: { type: Number, default: 0, min: 0 },
    deadline: { type: Date, required: [true, "Deadline is required"] },
    status: { type: String, enum: ["pending", "approved", "rejected", "completed"], default: "pending" },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    rejectionReason: { type: String, default: null },
    isReported: { type: Boolean, default: false },
    reportReason: { type: String, default: null },
  },
  { timestamps: true }
);
const Campaign = mongoose.model("Campaign", campaignSchema);

// Contribution Model
const contributionSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    supporter: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    amount: { type: Number, required: [true, "Contribution amount is required"], min: 1 },
    status: { type: String, enum: ["pending", "approved", "rejected", "refunded"], default: "pending" },
    message: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: true }
);
const Contribution = mongoose.model("Contribution", contributionSchema);

// Notification Model
const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    type: { type: String, required: true, enum: ["contribution_received", "contribution_approved", "contribution_rejected", "campaign_approved", "campaign_rejected", "withdrawal_approved"] },
    message: { type: String, required: true },
    refModel: { type: String, enum: ["Campaign", "Contribution", "Withdrawal"], default: null },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);
const Notification = mongoose.model("Notification", notificationSchema);

// Withdrawal Model
const CREDITS_PER_DOLLAR = 20;
const withdrawalSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    amountCredits: { type: Number, required: [true, "Withdrawal amount is required"], min: 200 },
    amountUSD: { type: Number },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    paymentMethod: { type: String, default: null },
    note: { type: String, default: null },
  },
  { timestamps: true }
);
withdrawalSchema.pre("save", function (next) {
  this.amountUSD = this.amountCredits / CREDITS_PER_DOLLAR;
  next();
});
const Withdrawal = mongoose.model("Withdrawal", withdrawalSchema);

// CreditPurchase Model
const creditPurchaseSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    credits: { type: Number, required: true },
    amountUSD: { type: Number, required: true },
    stripeSessionId: { type: String, required: true, unique: true },
    status: { type: String, enum: ["completed", "failed"], default: "completed" },
  },
  { timestamps: true }
);
const CreditPurchase = mongoose.model("CreditPurchase", creditPurchaseSchema);



// ==========================================
// 2. Better-Auth Configuration
// ==========================================
const ROLE_CREDITS = { supporter: 50, creator: 20, admin: 0 };
let _auth = null;

const getAuth = () => {
  if (_auth) return _auth;
  const db = mongoose.connection.getClient().db();

  _auth = betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
    trustedOrigins: [process.env.CLIENT_URL || "http://localhost:3000"],
    secret: process.env.BETTER_AUTH_SECRET,
    basePath: "/api/auth",
    database: mongodbAdapter(db),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    socialProviders: {
      google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    },
    plugins: [bearer()],
    user: {
      modelName: "users",
      additionalFields: {
        role: { type: "string", defaultValue: "supporter", input: true },
        credits: { type: "number", defaultValue: 0, input: false },
        bonusGranted: { type: "boolean", defaultValue: false, input: false },
      },
    },
    session: { modelName: "sessions" },
    account: { modelName: "accounts" },
    databaseHooks: {
      user: {
        create: {
          before: async (userData) => {
            const role = userData.role || "supporter";
            const bonusCredits = ROLE_CREDITS[role] ?? 50;
            return {
              data: { ...userData, role, credits: bonusCredits, bonusGranted: true },
            };
          },
        },
      },
    },
  });

  return _auth;
};


// ==========================================
// 3. Middlewares
// ==========================================
const requireAuth = async (req, res, next) => {
  try {
    const session = await getAuth().api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ success: false, message: "Unauthorized: Please login." });
    }
    req.user = session.user;
    req.session = session.session;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Unauthorized: Invalid or expired session." });
  }
};

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized: Not authenticated." });
    if (!allowedRoles.includes(req.user.role)) return res.status(403).json({ success: false, message: `Forbidden: Requires role: ${allowedRoles.join(" or ")}.` });
    next();
  };
};

const isAuthenticated = requireAuth;
const isAdmin = [requireAuth, requireRole("admin")];
const isCreator = [requireAuth, requireRole("creator")];


// ==========================================
// 4. API Controllers
// ==========================================

// --- Campaign Controllers ---

// @desc    Create a new campaign
// @route   POST /api/campaigns
// @access  Private/Creator
const createCampaign = async (req, res, next) => {
  try {
    const { title, description, category, goalAmount, deadline, coverImage } = req.body;
    
    const newCampaign = await Campaign.create({
      title,
      description,
      category,
      goalAmount,
      deadline,
      coverImage,
      creator: req.user.id,
      status: "pending", // Default status, needs admin approval
    });

    res.status(201).json({ success: true, message: "Campaign created successfully. Waiting for admin approval.", data: newCampaign });
  } catch (error) {
    next(error);
  }
};

// @desc    Get creator's own campaigns
// @route   GET /api/campaigns/my-campaigns
// @access  Private/Creator
const getMyCampaigns = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    
    // Build query
    const query = { creator: req.user.id };
    
    if (search) {
      query.title = { $regex: search, $options: "i" }; // Case-insensitive search on title
    }

    const startIndex = (page - 1) * limit;
    
    const campaigns = await Campaign.find(query)
      .sort({ createdAt: -1 })
      .skip(startIndex)
      .limit(limit);
      
    const total = await Campaign.countDocuments(query);

    res.status(200).json({
      success: true,
      count: campaigns.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: campaigns,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all approved campaigns (Public - Explore page)
// @route   GET /api/campaigns
// @access  Public
const getAllCampaigns = async (req, res, next) => {
  try {
    const campaigns = await Campaign.find({ status: "approved" })
      .populate("creator", "name image")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    next(error);
  }
};

// @desc    Get ALL campaigns for Admin (all statuses)
// @route   GET /api/admin/campaigns
// @access  Private/Admin
const getAllCampaignsAdmin = async (req, res, next) => {
  try {
    const { status } = req.query; // optional filter by status
    const query = status && status !== "all" ? { status } : {};

    const campaigns = await Campaign.find(query)
      .populate("creator", "name image email")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    next(error);
  }
};

// @desc    Update campaign status (Approve or Reject)
// @route   PATCH /api/admin/campaigns/:id/status
// @access  Private/Admin
const updateCampaignStatus = async (req, res, next) => {
  try {
    const { status, rejectionReason } = req.body;
    const validStatuses = ["approved", "rejected", "pending"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }

    const campaign = await Campaign.findById(req.params.id).populate("creator", "name");
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    campaign.status = status;
    if (status === "rejected" && rejectionReason) {
      campaign.rejectionReason = rejectionReason;
    }
    await campaign.save();

    // Create notification for the creator
    const notifType = status === "approved" ? "campaign_approved" : "campaign_rejected";
    const notifMessage =
      status === "approved"
        ? `Your campaign "${campaign.title}" has been approved and is now live!`
        : `Your campaign "${campaign.title}" was rejected. ${rejectionReason ? `Reason: ${rejectionReason}` : ""}`;

    await Notification.create({
      recipient: campaign.creator._id,
      type: notifType,
      message: notifMessage,
      refModel: "Campaign",
      refId: campaign._id,
    });

    res.status(200).json({ success: true, message: `Campaign ${status} successfully`, data: campaign });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single campaign by ID
// @route   GET /api/campaigns/:id
// @access  Public
const getCampaignById = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate("creator", "name image email");

    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
};

// --- User Controllers ---
const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find({}).select("-password").sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    next(error);
  }
};

// Update user role (Admin only)
const updateUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.email === "admin@admin.com") return res.status(403).json({ success: false, message: "Cannot change the role of the main admin" });
    if (!["admin", "creator", "supporter"].includes(role)) return res.status(400).json({ success: false, message: "Invalid role specified" });
    user.role = role;
    await user.save();
    res.status(200).json({ success: true, message: "User role updated successfully", data: user });
  } catch (error) {
    next(error);
  }
};

// Delete user (Admin only)
const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.email === "admin@admin.com") return res.status(403).json({ success: false, message: "Cannot delete the main admin" });
    await User.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// Update current user profile
const updateProfile = async (req, res, next) => {
  try {
    const { name, image } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (name) user.name = name;
    if (image) user.image = image;

    await user.save();
    res.status(200).json({ success: true, message: "Profile updated successfully", data: user });
  } catch (error) {
    next(error);
  }
};


// ==========================================
// 4b. Contribution Controllers
// ==========================================

// @desc    Supporter contributes credits to a campaign
// @route   POST /api/contributions
// @access  Private/Supporter
const createContribution = async (req, res, next) => {
  try {
    const { campaignId, amount, message } = req.body;
    const supporterId = req.user.id;

    if (!amount || amount < 1) {
      return res.status(400).json({ success: false, message: "Minimum contribution is 1 credit" });
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    if (campaign.status !== "approved") return res.status(400).json({ success: false, message: "This campaign is not accepting contributions" });

    const supporter = await User.findById(supporterId);
    if (!supporter) return res.status(404).json({ success: false, message: "User not found" });
    if (supporter.credits < amount) return res.status(400).json({ success: false, message: `Insufficient credits. You have ${supporter.credits} but tried to contribute ${amount}.` });

    // Deduct credits from supporter immediately (held in escrow)
    supporter.credits -= amount;
    await supporter.save();

    // Optimistically add to campaign's raisedAmount so progress shows immediately
    campaign.raisedAmount += amount;
    await campaign.save();

    const contribution = await Contribution.create({
      campaign: campaignId,
      supporter: supporterId,
      amount,
      message: message || null,
      status: "pending",
    });

    // Notify the campaign creator
    await Notification.create({
      recipient: campaign.creator,
      type: "contribution_received",
      message: `${supporter.name} contributed ${amount} credits to your campaign "${campaign.title}".`,
      refModel: "Contribution",
      refId: contribution._id,
    });

    res.status(201).json({ success: true, message: "Contribution submitted successfully!", data: contribution });
  } catch (error) {
    next(error);
  }
};

// @desc    Get supporter's own contributions (paginated)
// @route   GET /api/contributions/my-contributions
// @access  Private/Supporter
const getMyContributions = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { supporter: req.user.id };
    const total = await Contribution.countDocuments(query);
    const contributions = await Contribution.find(query)
      .populate("campaign", "title coverImage category")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true, count: contributions.length, total,
      page, totalPages: Math.ceil(total / limit),
      data: contributions,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all contributions for creator's campaigns (pending)
// @route   GET /api/creator/contributions
// @access  Private/Creator
const getCreatorContributions = async (req, res, next) => {
  try {
    const { status } = req.query;
    // Find all campaigns by this creator
    const myCampaigns = await Campaign.find({ creator: req.user.id }).select("_id");
    const campaignIds = myCampaigns.map(c => c._id);

    const query = { campaign: { $in: campaignIds } };
    if (status && status !== "all") query.status = status;

    const contributions = await Contribution.find(query)
      .populate("supporter", "name image email")
      .populate("campaign", "title coverImage")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: contributions.length, data: contributions });
  } catch (error) {
    next(error);
  }
};

// @desc    Creator approves or rejects a contribution
// @route   PATCH /api/creator/contributions/:id/status
// @access  Private/Creator
const updateContributionStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const contribution = await Contribution.findById(req.params.id)
      .populate("campaign", "title creator")
      .populate("supporter", "name");

    if (!contribution) return res.status(404).json({ success: false, message: "Contribution not found" });
    if (contribution.campaign.creator.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: "You are not the creator of this campaign" });
    }
    if (contribution.status !== "pending") {
      return res.status(400).json({ success: false, message: "This contribution has already been processed" });
    }

    if (status === "approved") {
      // Credits were already added to campaign's raisedAmount during creation
      contribution.status = "approved";
    } else {
      // Refund credits back to supporter
      await User.findByIdAndUpdate(contribution.supporter._id, { $inc: { credits: contribution.amount } });
      // Remove from campaign's raisedAmount since it was rejected
      await Campaign.findByIdAndUpdate(contribution.campaign._id, { $inc: { raisedAmount: -contribution.amount } });
      contribution.status = "rejected";
    }
    await contribution.save();

    // Notify the supporter
    const notifType = status === "approved" ? "contribution_approved" : "contribution_rejected";
    const notifMsg = status === "approved"
      ? `Your ${contribution.amount}-credit contribution to "${contribution.campaign.title}" was approved!`
      : `Your ${contribution.amount}-credit contribution to "${contribution.campaign.title}" was rejected and refunded.`;

    await Notification.create({
      recipient: contribution.supporter._id,
      type: notifType,
      message: notifMsg,
      refModel: "Contribution",
      refId: contribution._id,
    });

    res.status(200).json({ success: true, message: `Contribution ${status} successfully`, data: contribution });
  } catch (error) {
    next(error);
  }
};


// ==========================================
// 4c. Stripe Controllers
// ==========================================

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const CREDIT_PACKAGES = [
  { id: "pkg_100", credits: 100, price: 500,  label: "Starter Pack",   description: "100 Credits for $5" },
  { id: "pkg_300", credits: 300, price: 1200, label: "Growth Pack",    description: "300 Credits for $12" },
  { id: "pkg_500", credits: 500, price: 2000, label: "Pro Pack",       description: "500 Credits for $20" },
  { id: "pkg_1000",credits: 1000,price: 3500, label: "Unlimited Pack", description: "1000 Credits for $35" },
];

// @desc    Get available credit packages
// @route   GET /api/stripe/packages
// @access  Public
const getCreditPackages = async (req, res) => {
  res.status(200).json({ success: true, data: CREDIT_PACKAGES });
};

// @desc    Create a Stripe checkout session
// @route   POST /api/stripe/create-checkout-session
// @access  Private
const createCheckoutSession = async (req, res, next) => {
  try {
    const { packageId } = req.body;
    const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
    if (!pkg) return res.status(400).json({ success: false, message: "Invalid package" });

    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: pkg.label, description: pkg.description },
          unit_amount: pkg.price,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${clientUrl}/dashboard/supporter/wallet/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/dashboard/supporter/wallet`,
      metadata: {
        userId: req.user.id,
        credits: pkg.credits.toString(),
        packageId: pkg.id,
      },
    });

    res.status(200).json({ success: true, url: session.url });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify payment and add credits after success
// @route   GET /api/stripe/verify-payment?session_id=xxx
// @access  Private
const verifyPayment = async (req, res, next) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ success: false, message: "Missing session_id" });

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== "paid") {
      return res.status(400).json({ success: false, message: "Payment not completed" });
    }

    // Prevent double crediting: check if already processed
    const { userId, credits } = session.metadata;
    const alreadyProcessed = await CreditPurchase.findOne({ stripeSessionId: session_id });
    if (alreadyProcessed) {
      return res.status(200).json({ success: true, message: "Already processed", data: alreadyProcessed });
    }

    const creditsToAdd = parseInt(credits);
    const user = await User.findByIdAndUpdate(userId, { $inc: { credits: creditsToAdd } }, { new: true });

    const purchase = await CreditPurchase.create({
      user: userId,
      credits: creditsToAdd,
      amountUSD: session.amount_total / 100,
      stripeSessionId: session_id,
      status: "completed",
    });

    res.status(200).json({ success: true, message: `${creditsToAdd} credits added!`, data: purchase });
  } catch (error) {
    next(error);
  }
};

// @desc    Get supporter's credit purchase history
// @route   GET /api/stripe/payment-history
// @access  Private
const getPaymentHistory = async (req, res, next) => {
  try {
    const history = await CreditPurchase.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: history.length, data: history });
  } catch (error) {
    next(error);
  }
};


// ==========================================
// 4d. Withdrawal Controllers
// ==========================================

// @desc    Get creator's balance summary
// @route   GET /api/creator/balance
// @access  Private/Creator
const getCreatorBalance = async (req, res, next) => {
  try {
    const creatorId = req.user.id;

    // Get all approved contributions for creator's campaigns
    const approvedContribs = await Contribution.aggregate([
      { $match: { status: { $in: ["approved", "pending"] } } },
      { $lookup: { from: "campaigns", localField: "campaign", foreignField: "_id", as: "campaignData" } },
      { $unwind: "$campaignData" },
      { $match: { "campaignData.creator": new mongoose.Types.ObjectId(creatorId) } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalEarned = approvedContribs[0]?.total || 0;

    // Get withdrawn amounts (pending or approved)
    const withdrawnAgg = await Withdrawal.aggregate([
      { $match: { creator: new mongoose.Types.ObjectId(creatorId), status: { $in: ["pending", "approved"] } } },
      { $group: { _id: null, total: { $sum: "$amountCredits" } } },
    ]);
    const totalWithdrawn = withdrawnAgg[0]?.total || 0;
    const available = totalEarned - totalWithdrawn;

    res.status(200).json({ success: true, data: { totalEarned, totalWithdrawn, available } });
  } catch (error) {
    next(error);
  }
};

// @desc    Creator requests a withdrawal
// @route   POST /api/withdrawals
// @access  Private/Creator
const createWithdrawal = async (req, res, next) => {
  try {
    const { amountCredits, paymentMethod, note } = req.body;
    const creatorId = req.user.id;

    if (!amountCredits || amountCredits < 200) {
      return res.status(400).json({ success: false, message: "Minimum withdrawal is 200 credits ($10)" });
    }

    const creator = await User.findById(creatorId);
    if (!creator) return res.status(404).json({ success: false, message: "User not found" });

    // Check available balance from approved contributions
    const approvedContribs = await Contribution.aggregate([
      { $match: { status: "approved" } },
      { $lookup: { from: "campaigns", localField: "campaign", foreignField: "_id", as: "campaignData" } },
      { $unwind: "$campaignData" },
      { $match: { "campaignData.creator": new mongoose.Types.ObjectId(creatorId) } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalEarned = approvedContribs[0]?.total || 0;

    // Subtract already withdrawn
    const withdrawals = await Withdrawal.aggregate([
      { $match: { creator: new mongoose.Types.ObjectId(creatorId), status: { $in: ["pending", "approved"] } } },
      { $group: { _id: null, total: { $sum: "$amountCredits" } } },
    ]);
    const totalWithdrawn = withdrawals[0]?.total || 0;
    const available = totalEarned - totalWithdrawn;

    if (amountCredits > available) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Available: ${available} credits.` });
    }

    const withdrawal = await Withdrawal.create({
      creator: creatorId,
      amountCredits,
      paymentMethod,
      note,
    });

    res.status(201).json({ success: true, message: "Withdrawal request submitted", data: withdrawal });
  } catch (error) {
    next(error);
  }
};

// @desc    Creator's withdrawal history
// @route   GET /api/creator/withdrawals
// @access  Private/Creator
const getCreatorWithdrawals = async (req, res, next) => {
  try {
    const withdrawals = await Withdrawal.find({ creator: req.user.id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: withdrawals.length, data: withdrawals });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin gets all withdrawal requests
// @route   GET /api/admin/withdrawals
// @access  Private/Admin
const getAdminWithdrawals = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = status && status !== "all" ? { status } : {};
    const withdrawals = await Withdrawal.find(query)
      .populate("creator", "name image email")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: withdrawals.length, data: withdrawals });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin approves or rejects a withdrawal
// @route   PATCH /api/admin/withdrawals/:id/status
// @access  Private/Admin
const updateWithdrawalStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const withdrawal = await Withdrawal.findById(req.params.id).populate("creator", "name");
    if (!withdrawal) return res.status(404).json({ success: false, message: "Withdrawal not found" });
    if (withdrawal.status !== "pending") {
      return res.status(400).json({ success: false, message: "This withdrawal has already been processed" });
    }

    withdrawal.status = status;
    await withdrawal.save();

    // Notify creator
    const notifMsg = status === "approved"
      ? `Your withdrawal of ${withdrawal.amountCredits} credits ($${withdrawal.amountUSD}) has been approved!`
      : `Your withdrawal request of ${withdrawal.amountCredits} credits was rejected.`;

    await Notification.create({
      recipient: withdrawal.creator._id,
      type: "withdrawal_approved",
      message: notifMsg,
      refModel: "Withdrawal",
      refId: withdrawal._id,
    });

    res.status(200).json({ success: true, message: `Withdrawal ${status}`, data: withdrawal });
  } catch (error) {
    next(error);
  }
};

// @desc    Get creator's available balance
// @route   GET /api/creator/balance
// @access  Private/Creator
const getCreatorBalance = async (req, res, next) => {
  try {
    const creatorId = req.user.id;
    const approvedContribs = await Contribution.aggregate([
      { $match: { status: "approved" } },
      { $lookup: { from: "campaigns", localField: "campaign", foreignField: "_id", as: "campaignData" } },
      { $unwind: "$campaignData" },
      { $match: { "campaignData.creator": new mongoose.Types.ObjectId(creatorId) } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalEarned = approvedContribs[0]?.total || 0;
    const withdrawals = await Withdrawal.aggregate([
      { $match: { creator: new mongoose.Types.ObjectId(creatorId), status: { $in: ["pending", "approved"] } } },
      { $group: { _id: null, total: { $sum: "$amountCredits" } } },
    ]);
    const totalWithdrawn = withdrawals[0]?.total || 0;
    res.status(200).json({ success: true, data: { totalEarned, totalWithdrawn, available: totalEarned - totalWithdrawn } });
  } catch (error) {
    next(error);
  }
};


// ==========================================
// 5. Express App Setup & Server Start
// ==========================================

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Connect to MongoDB BEFORE handling routes
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log(`🚀 MongoDB Connected: ${mongoose.connection.host}`))
  .catch((err) => {
    console.error(`❌ MongoDB connection error: ${err.message}`);
    process.exit(1);
  });

// Better-Auth handler
app.all(["/api/auth", "/api/auth/*path"], (req, res, next) => {
  toNodeHandler(getAuth())(req, res, next);
});

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Default Route
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🚀 Crowdfunding Platform API is running",
    version: "1.0.0",
    environment: process.env.NODE_ENV,
  });
});

// --- API Routes ---

// Campaign Routes (Public & Creator)
app.post("/api/campaigns", ...isCreator, createCampaign);
app.get("/api/campaigns/my-campaigns", ...isCreator, getMyCampaigns);
app.get("/api/campaigns", getAllCampaigns);
app.get("/api/campaigns/:id", getCampaignById);

// Admin Campaign Management Routes
app.get("/api/admin/campaigns", ...isAdmin, getAllCampaignsAdmin);
app.patch("/api/admin/campaigns/:id/status", ...isAdmin, updateCampaignStatus);

// Get current user's fresh data (bypasses session cache)
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// User Management Routes
app.get("/api/users", ...isAdmin, getAllUsers);
app.get("/api/users/me", isAuthenticated, getMe);
app.patch("/api/users/me", isAuthenticated, updateProfile);
app.patch("/api/users/:id/role", ...isAdmin, updateUserRole);
app.delete("/api/users/:id", ...isAdmin, deleteUser);

// Contribution Routes
app.post("/api/contributions", isAuthenticated, createContribution);
app.get("/api/contributions/my-contributions", isAuthenticated, getMyContributions);
app.get("/api/creator/contributions", ...isCreator, getCreatorContributions);
app.patch("/api/creator/contributions/:id/status", ...isCreator, updateContributionStatus);

// Stripe Routes
app.get("/api/stripe/packages", getCreditPackages);
app.post("/api/stripe/create-checkout-session", isAuthenticated, createCheckoutSession);
app.get("/api/stripe/verify-payment", isAuthenticated, verifyPayment);
app.get("/api/stripe/payment-history", isAuthenticated, getPaymentHistory);

// Withdrawal Routes
app.post("/api/withdrawals", ...isCreator, createWithdrawal);
app.get("/api/creator/withdrawals", ...isCreator, getCreatorWithdrawals);
app.get("/api/creator/balance", ...isCreator, getCreatorBalance);
app.get("/api/admin/withdrawals", ...isAdmin, getAdminWithdrawals);
app.patch("/api/admin/withdrawals/:id/status", ...isAdmin, updateWithdrawalStatus);


// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.stack);
  res.status(err.statusCode || 500).json({ success: false, message: err.message || "Internal Server Error" });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📌 Environment: ${process.env.NODE_ENV}`);
});
