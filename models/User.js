const mongoose = require("mongoose")

const userSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    profileImage: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      coordinates: {
        latitude: Number,
        longitude: Number,
      },
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ["customer", "captain", "admin"],
      default: "customer",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    preferences: {
      language: {
        type: String,
        default: "en",
      },
      darkMode: {
        type: Boolean,
        default: false,
      },
      notifications: {
        orderUpdates: { type: Boolean, default: true },
        promotions: { type: Boolean, default: true },
        newRestaurants: { type: Boolean, default: false },
      },
    },
    stats: {
      totalOrders: { type: Number, default: 0 },
      totalSpent: { type: Number, default: 0 },
      favoriteRestaurants: [{ type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" }],
    },
  },
  {
    timestamps: true,
  },
)

// Index for faster queries
userSchema.index({ phoneNumber: 1 })
userSchema.index({ username: 1 })

module.exports = mongoose.model("User", userSchema)
