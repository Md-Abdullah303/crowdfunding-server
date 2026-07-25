import express from "express";
// Trigger nodemon restart to pick up .env changes
import cors from "cors";
import "dotenv/config";
import { toNodeHandler } from "better-auth/node";
import { fromNodeHeaders } from "better-auth/node";

import connectDB from "./config/db.js";
import { getAuth } from "./lib/auth.js";

// Route imports (uncommented as they are built)
// import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
// import campaignRoutes from "./routes/campaign.routes.js";
// import contributionRoutes from "./routes/contribution.routes.js";
// import withdrawalRoutes from "./routes/withdrawal.routes.js";
// import notificationRoutes from "./routes/notification.routes.js";

const app = express();
const PORT = process.env.PORT || 5000;

// ─── CORS (must be before better-auth handler) ────────────────────────────────
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Connect to MongoDB FIRST ────────────────────────────────────────────────
await connectDB();

// ─── Better-Auth Handler ──────────────────────────────────────────────────────
// Mounted AFTER connectDB (so mongoose is ready) and BEFORE express.json()
app.all(["/api/auth", "/api/auth/*path"], toNodeHandler(getAuth()));

// ─── Body Parsers (after better-auth) ────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🚀 Crowdfunding Platform API is running",
    version: "1.0.0",
    environment: process.env.NODE_ENV,
  });
});

// app.use("/api/auth/user", authRoutes);
app.use("/api/users", userRoutes);
// app.use("/api/campaigns", campaignRoutes);
// app.use("/api/contributions", contributionRoutes);
// app.use("/api/withdrawals", withdrawalRoutes);
// app.use("/api/notifications", notificationRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ─── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.stack);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📌 Environment: ${process.env.NODE_ENV}`);
});
