const mongoose = require("mongoose")

const restaurantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    image: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: ["fast-food", "pizza", "asian", "middle-eastern", "desserts", "healthy", "coffee"],
    },
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
    },
    address: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      zipCode: { type: String, required: true },
      coordinates: {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
      },
    },
    contact: {
      phone: String,
      email: String,
    },
    operatingHours: {
      monday: { open: String, close: String, isOpen: Boolean },
      tuesday: { open: String, close: String, isOpen: Boolean },
      wednesday: { open: String, close: String, isOpen: Boolean },
      thursday: { open: String, close: String, isOpen: Boolean },
      friday: { open: String, close: String, isOpen: Boolean },
      saturday: { open: String, close: String, isOpen: Boolean },
      sunday: { open: String, close: String, isOpen: Boolean },
    },
    deliveryInfo: {
      fee: { type: Number, required: true },
      minimumOrder: { type: Number, required: true },
      estimatedTime: { type: String, required: true }, // e.g., "30-45 min"
      radius: { type: Number, required: true }, // delivery radius in km
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
)

// Index for geospatial queries
restaurantSchema.index({ "address.coordinates": "2dsphere" })
restaurantSchema.index({ category: 1 })
restaurantSchema.index({ "rating.average": -1 })

module.exports = mongoose.model("Restaurant", restaurantSchema)
