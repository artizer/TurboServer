const express = require("express")
const Order = require("../models/Order")
const User = require("../models/User")
const Restaurant = require("../models/Restaurant")
const FoodItem = require("../models/FoodItem")
const { authenticateToken } = require("../middleware/auth")
const { broadcastOrderToCaptains } = require("../socket/socketHandler")

const router = express.Router()

// Generate confirmation code
const generateConfirmationCode = () => {
  return Math.floor(1000 + Math.random() * 9000).toString()
}

// Create new order
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { restaurantId, items, deliveryAddress, paymentMethod, specialInstructions } = req.body

    // Validate restaurant
    const restaurant = await Restaurant.findById(restaurantId)
    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" })
    }

    // Validate and calculate items
    let subtotal = 0
    const orderItems = []

    for (const item of items) {
      const foodItem = await FoodItem.findById(item.foodItemId)
      if (!foodItem) {
        return res.status(404).json({ message: `Food item ${item.foodItemId} not found` })
      }

      const itemTotal = foodItem.price * item.quantity
      subtotal += itemTotal

      orderItems.push({
        foodItem: foodItem._id,
        quantity: item.quantity,
        price: foodItem.price,
        specialInstructions: item.specialInstructions,
      })
    }

    // Calculate pricing
    const deliveryFee = restaurant.deliveryInfo.fee
    const tax = subtotal * 0.1 // 10% tax
    const total = subtotal + deliveryFee + tax

    // Generate confirmation code
    const confirmationCode = generateConfirmationCode()

    // Create order
    const order = new Order({
      customer: req.user.userId,
      restaurant: restaurantId,
      items: orderItems,
      deliveryAddress,
      pricing: {
        subtotal,
        deliveryFee,
        tax,
        total,
      },
      paymentMethod,
      specialInstructions,
      confirmationCode: {
        code: confirmationCode,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
      estimatedDeliveryTime: new Date(Date.now() + 45 * 60 * 1000), // 45 minutes
      timeline: [
        {
          status: "placed",
          note: "Order placed successfully",
        },
      ],
    })

    await order.save()

    // Populate order details
    await order.populate([
      { path: "restaurant", select: "name image address" },
      { path: "items.foodItem", select: "name image price" },
    ])

    // Update user stats
    await User.findByIdAndUpdate(req.user.userId, {
      $inc: { "stats.totalOrders": 1, "stats.totalSpent": total },
    })

    // Broadcast to available captains
    broadcastOrderToCaptains(req.io, order)

    // Emit to customer
    req.io.to(`user_${req.user.userId}`).emit("order_placed", {
      orderId: order._id,
      orderNumber: order.orderNumber,
      confirmationCode: confirmationCode,
      estimatedDeliveryTime: order.estimatedDeliveryTime,
    })

    res.status(201).json({
      message: "Order placed successfully",
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        confirmationCode: confirmationCode,
        status: order.status,
        total: order.pricing.total,
        estimatedDeliveryTime: order.estimatedDeliveryTime,
        restaurant: order.restaurant,
        items: order.items,
      },
    })
  } catch (error) {
    console.error("Create order error:", error)
    res.status(500).json({ message: "Failed to create order" })
  }
})

// Get user's orders
router.get("/my-orders", authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query

    const query = { customer: req.user.userId }
    if (status) {
      query.status = status
    }

    const orders = await Order.find(query)
      .populate("restaurant", "name image")
      .populate("items.foodItem", "name image price")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)

    const total = await Order.countDocuments(query)

    res.json({
      orders,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error("Get orders error:", error)
    res.status(500).json({ message: "Failed to fetch orders" })
  }
})

// Get order details
router.get("/:orderId", authenticateToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate("restaurant")
      .populate("items.foodItem")
      .populate("captain", "username profileImage")
      .populate("customer", "username profileImage")

    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    // Check if user has access to this order
    if (
      order.customer._id.toString() !== req.user.userId &&
      order.captain?._id.toString() !== req.user.userId &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ message: "Access denied" })
    }

    res.json({ order })
  } catch (error) {
    console.error("Get order error:", error)
    res.status(500).json({ message: "Failed to fetch order" })
  }
})

// Confirm delivery with code
router.post("/:orderId/confirm-delivery", authenticateToken, async (req, res) => {
  try {
    const { confirmationCode } = req.body
    const orderId = req.params.orderId

    const order = await Order.findById(orderId)
    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    // Check if user is the assigned captain
    if (order.captain?.toString() !== req.user.userId) {
      return res.status(403).json({ message: "Only assigned captain can confirm delivery" })
    }

    // Validate confirmation code
    if (order.confirmationCode.code !== confirmationCode) {
      return res.status(400).json({ message: "Invalid confirmation code" })
    }

    if (order.confirmationCode.isUsed) {
      return res.status(400).json({ message: "Confirmation code already used" })
    }

    if (new Date() > order.confirmationCode.expiresAt) {
      return res.status(400).json({ message: "Confirmation code expired" })
    }

    // Update order status
    order.status = "delivered"
    order.confirmationCode.isUsed = true
    order.actualDeliveryTime = new Date()
    order.timeline.push({
      status: "delivered",
      note: "Order delivered and confirmed with code",
    })

    await order.save()

    // Update captain stats
    const Captain = require("../models/Captain")
    await Captain.findOneAndUpdate(
      { user: req.user.userId },
      {
        $inc: {
          "stats.totalDeliveries": 1,
          "availability.currentOrders": -1,
        },
      },
    )

    // Notify customer
    req.io.to(`user_${order.customer}`).emit("order_delivered", {
      orderId: order._id,
      deliveredAt: order.actualDeliveryTime,
    })

    res.json({
      message: "Delivery confirmed successfully",
      order: {
        id: order._id,
        status: order.status,
        deliveredAt: order.actualDeliveryTime,
      },
    })
  } catch (error) {
    console.error("Confirm delivery error:", error)
    res.status(500).json({ message: "Failed to confirm delivery" })
  }
})

// Cancel order
router.patch("/:orderId/cancel", authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body
    const order = await Order.findById(req.params.orderId)

    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    // Check if user can cancel this order
    if (order.customer.toString() !== req.user.userId) {
      return res.status(403).json({ message: "Access denied" })
    }

    // Check if order can be cancelled
    if (["delivered", "cancelled"].includes(order.status)) {
      return res.status(400).json({ message: "Order cannot be cancelled" })
    }

    order.status = "cancelled"
    order.timeline.push({
      status: "cancelled",
      note: reason || "Order cancelled by customer",
    })

    await order.save()

    // Notify captain if assigned
    if (order.captain) {
      req.io.to(`user_${order.captain}`).emit("order_cancelled", {
        orderId: order._id,
        reason,
      })
    }

    res.json({
      message: "Order cancelled successfully",
      order: {
        id: order._id,
        status: order.status,
      },
    })
  } catch (error) {
    console.error("Cancel order error:", error)
    res.status(500).json({ message: "Failed to cancel order" })
  }
})

// Rate order
router.post("/:orderId/rate", authenticateToken, async (req, res) => {
  try {
    const { foodRating, deliveryRating, comment } = req.body
    const order = await Order.findById(req.params.orderId)

    if (!order) {
      return res.status(404).json({ message: "Order not found" })
    }

    if (order.customer.toString() !== req.user.userId) {
      return res.status(403).json({ message: "Access denied" })
    }

    if (order.status !== "delivered") {
      return res.status(400).json({ message: "Can only rate delivered orders" })
    }

    order.rating = {
      food: foodRating,
      delivery: deliveryRating,
      comment,
    }

    await order.save()

    res.json({
      message: "Order rated successfully",
      rating: order.rating,
    })
  } catch (error) {
    console.error("Rate order error:", error)
    res.status(500).json({ message: "Failed to rate order" })
  }
})

module.exports = router
