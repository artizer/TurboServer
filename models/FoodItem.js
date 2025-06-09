const mongoose = require("mongoose")

const foodItemSchema = new mongoose.Schema(
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
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    originalPrice: {
      type: Number,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      enum: ["appetizer", "main-course", "dessert", "beverage", "side-dish"],
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    ingredients: [String],
    allergens: [String],
    nutritionalInfo: {
      calories: Number,
      protein: Number,
      carbs: Number,
      fat: Number,
    },
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
    },
    tags: [String], // e.g., ['spicy', 'vegetarian', 'gluten-free']
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
    preparationTime: {
      type: String,
      default: "15-20 min",
    },
  },
  {
    timestamps: true,
  },
)

// Indexes for better query performance
foodItemSchema.index({ restaurant: 1 })
foodItemSchema.index({ category: 1 })
foodItemSchema.index({ "rating.average": -1 })
foodItemSchema.index({ name: "text", description: "text" })

module.exports = mongoose.model("FoodItem", foodItemSchema)
