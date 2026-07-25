const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/db");

// Route imports
// const authRoutes = require("./routes/auth.routes");
// const userRoutes = require("./routes/user.routes");
// const campaignRoutes = require("./routes/campaign.routes");
// const contributionRoutes = require("./routes/contribution.routes");
// const withdrawalRoutes = require("./routes/withdrawal.routes");
// const notificationRoutes = require("./routes/notification.routes");

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// ─── Middlewares ──────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🚀 Crowdfunding Platform API is running",
    version: "1.0.0",
    environment: process.env.NODE_ENV,
  });
});

// app.use("/api/auth", authRoutes);
// app.use("/api/users", userRoutes);
// app.use("/api/campaigns", campaignRoutes);
// app.use("/api/contributions", contributionRoutes);
// app.use("/api/withdrawals", withdrawalRoutes);
// app.use("/api/notifications", notificationRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.stack);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📌 Environment: ${process.env.NODE_ENV}`);
});
