const mongoose = require("mongoose")

const captainSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    vehicleInfo: {
      type: {
        type: String,
        enum: ["motorcycle", "bicycle", "car", "scooter"],
        required: true,
      },
      model: String,
      plateNumber: String,
      color: String,
    },
    documents: {
      drivingLicense: {
        number: String,
        expiryDate: Date,
        isVerified: { type: Boolean, default: false },
      },
      vehicleRegistration: {
        number: String,
        expiryDate: Date,
        isVerified: { type: Boolean, default: false },
      },
      insurance: {
        number: String,
        expiryDate: Date,
        isVerified: { type: Boolean, default: false },
      },
    },
    currentLocation: {
      latitude: Number,
      longitude: Number,
      lastUpdated: Date,
    },
    workingHours: {
      start: String, // e.g., "09:00"
      end: String, // e.g., "22:00"
      isWorking: { type: Boolean, default: false },
    },
    stats: {
      totalDeliveries: { type: Number, default: 0 },
      totalEarnings: { type: Number, default: 0 },
      rating: {
        average: { type: Number, default: 0, min: 0, max: 5 },
        count: { type: Number, default: 0 },
      },
      completionRate: { type: Number, default: 0 }, // percentage
      onTimeDeliveries: { type: Number, default: 0 },
    },
    availability: {
      isOnline: { type: Boolean, default: false },
      isAvailable: { type: Boolean, default: true },
      maxOrders: { type: Number, default: 3 },
      currentOrders: { type: Number, default: 0 },
    },
    bankDetails: {
      accountNumber: String,
      routingNumber: String,
      accountHolderName: String,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
)

// Index for geospatial queries
captainSchema.index({ currentLocation: "2dsphere" })
captainSchema.index({ "availability.isOnline": 1, "availability.isAvailable": 1 })

module.exports = mongoose.model("Captain", captainSchema)
