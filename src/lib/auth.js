import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { bearer } from "better-auth/plugins";
import mongoose from "mongoose";

// Registration credit bonuses
const ROLE_CREDITS = {
  supporter: 50,
  creator: 20,
  admin: 0,
};

let _auth = null;

/**
 * Returns the better-auth instance.
 * Lazy-initialized after MongoDB is connected (mongoose.connection must be ready).
 */
export const getAuth = () => {
  if (_auth) return _auth;

  const db = mongoose.connection.getClient().db();

  _auth = betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
    secret: process.env.BETTER_AUTH_SECRET,
    basePath: "/api/auth",

    // Use MongoDB adapter via Mongoose's underlying MongoClient
    database: mongodbAdapter(db),

    // Email & Password Authentication
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },

    // Google OAuth Sign-in
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    },

    // Plugins: bearer token for Authorization header support
    plugins: [bearer()],

    // Additional fields stored in the user collection
    user: {
      modelName: "users",
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "supporter",
          input: true, // Allow passing role during sign-up
        },
        credits: {
          type: "number",
          defaultValue: 0,
          input: false, // Credits are NOT user-inputtable, set by server hook
        },
        bonusGranted: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
      },
    },
    session: {
      modelName: "sessions",
    },
    account: {
      modelName: "accounts",
    },

    // Database hooks: grant registration bonus on user creation
    databaseHooks: {
      user: {
        create: {
          before: async (userData) => {
            const role = userData.role || "supporter";
            const bonusCredits = ROLE_CREDITS[role] ?? 50;

            return {
              data: {
                ...userData,
                role,
                credits: bonusCredits,
                bonusGranted: true,
              },
            };
          },
        },
      },
    },
  });

  return _auth;
};
