import express from "express";
import cors from "cors";
import "dotenv/config";
import mongoose from "mongoose";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { bearer } from "better-auth/plugins";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";

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

// Better-Auth handler (mounted after DB connection is initiated, getAuth handles lazy init)
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

// Campaign Routes
app.post("/api/campaigns", ...isCreator, createCampaign);
app.get("/api/campaigns/my-campaigns", ...isCreator, getMyCampaigns);

// User Management Routes
app.get("/api/users", ...isAdmin, getAllUsers);
app.patch("/api/users/me", isAuthenticated, updateProfile);
app.patch("/api/users/:id/role", ...isAdmin, updateUserRole);
app.delete("/api/users/:id", ...isAdmin, deleteUser);

// Placeholder for other routes (Campaigns, Contributions, etc.)
// app.get("/api/campaigns", ...);


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
