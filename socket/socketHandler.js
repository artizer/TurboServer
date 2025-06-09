const jwt = require("jsonwebtoken")
const Order = require("../models/Order")
const Captain = require("../models/Captain")

// Store active connections
const activeConnections = new Map()
const captainLocations = new Map()

const socketHandler = (io) => {
  // Socket authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token
      if (!token) {
        return next(new Error("Authentication error"))
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || "turbo-delivery-secret")
      socket.userId = decoded.userId
      socket.userRole = decoded.role
      next()
    } catch (err) {
      next(new Error("Authentication error"))
    }
  })

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.userId} (${socket.userRole})`)

    // Store active connection
    activeConnections.set(socket.userId, {
      socketId: socket.id,
      role: socket.userRole,
      lastSeen: new Date(),
    })

    // Join user to their personal room
    socket.join(`user_${socket.userId}`)

    // Captain-specific events
    if (socket.userRole === "captain") {
      handleCaptainEvents(socket, io)
    }

    // Customer-specific events
    if (socket.userRole === "customer") {
      handleCustomerEvents(socket, io)
    }

    // Common events
    handleCommonEvents(socket, io)

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.userId}`)
      activeConnections.delete(socket.userId)

      if (socket.userRole === "captain") {
        captainLocations.delete(socket.userId)
        // Update captain offline status
        updateCaptainStatus(socket.userId, false)
      }
    })
  })
}

const handleCaptainEvents = (socket, io) => {
  // Captain goes online/offline
  socket.on("captain_status_update", async (data) => {
    try {
      const { isOnline, isAvailable } = data

      await Captain.findOneAndUpdate(
        { user: socket.userId },
        {
          "availability.isOnline": isOnline,
          "availability.isAvailable": isAvailable,
        },
      )

      // Notify admin dashboard
      io.to("admin_room").emit("captain_status_changed", {
        captainId: socket.userId,
        isOnline,
        isAvailable,
      })

      socket.emit("status_updated", { success: true })
    } catch (error) {
      socket.emit("error", { message: "Failed to update status" })
    }
  })

  // Captain location update
  socket.on("location_update", async (data) => {
    try {
      const { latitude, longitude } = data

      // Store in memory for real-time tracking
      captainLocations.set(socket.userId, {
        latitude,
        longitude,
        timestamp: new Date(),
      })

      // Update database every 30 seconds (implement throttling)
      await Captain.findOneAndUpdate(
        { user: socket.userId },
        {
          "currentLocation.latitude": latitude,
          "currentLocation.longitude": longitude,
          "currentLocation.lastUpdated": new Date(),
        },
      )

      // Notify customers tracking this captain
      const captain = await Captain.findOne({ user: socket.userId }).populate("user")
      if (captain) {
        // Find active orders for this captain
        const activeOrders = await Order.find({
          captain: socket.userId,
          status: { $in: ["picked-up", "on-the-way"] },
        })

        // Emit location to customers of active orders
        activeOrders.forEach((order) => {
          io.to(`user_${order.customer}`).emit("captain_location_update", {
            orderId: order._id,
            location: { latitude, longitude },
            timestamp: new Date(),
          })
        })
      }
    } catch (error) {
      console.error("Location update error:", error)
    }
  })

  // Captain accepts/rejects order
  socket.on("order_response", async (data) => {
    try {
      const { orderId, action } = data // action: 'accept' or 'reject'

      const order = await Order.findById(orderId)
      if (!order) {
        return socket.emit("error", { message: "Order not found" })
      }

      if (action === "accept") {
        order.captain = socket.userId
        order.status = "confirmed"
        order.timeline.push({
          status: "confirmed",
          note: "Order accepted by captain",
        })

        // Update captain's current orders count
        await Captain.findOneAndUpdate({ user: socket.userId }, { $inc: { "availability.currentOrders": 1 } })
      }

      await order.save()

      // Notify customer
      io.to(`user_${order.customer}`).emit("order_status_update", {
        orderId: order._id,
        status: order.status,
        captain: action === "accept" ? socket.userId : null,
        timestamp: new Date(),
      })

      // Notify other captains that order is taken
      if (action === "accept") {
        socket.broadcast.emit("order_taken", { orderId })
      }

      socket.emit("order_response_success", { orderId, action })
    } catch (error) {
      socket.emit("error", { message: "Failed to process order response" })
    }
  })

  // Captain updates order status
  socket.on("update_order_status", async (data) => {
    try {
      const { orderId, status, note } = data

      const order = await Order.findById(orderId)
      if (!order || order.captain.toString() !== socket.userId) {
        return socket.emit("error", { message: "Unauthorized or order not found" })
      }

      order.status = status
      order.timeline.push({
        status,
        note: note || `Order ${status}`,
      })

      if (status === "delivered") {
        order.actualDeliveryTime = new Date()
        // Decrease captain's current orders count
        await Captain.findOneAndUpdate(
          { user: socket.userId },
          { $inc: { "availability.currentOrders": -1, "stats.totalDeliveries": 1 } },
        )
      }

      await order.save()

      // Notify customer
      io.to(`user_${order.customer}`).emit("order_status_update", {
        orderId: order._id,
        status: order.status,
        timestamp: new Date(),
        note,
      })

      socket.emit("status_update_success", { orderId, status })
    } catch (error) {
      socket.emit("error", { message: "Failed to update order status" })
    }
  })
}

const handleCustomerEvents = (socket, io) => {
  // Customer joins order tracking room
  socket.on("track_order", (data) => {
    const { orderId } = data
    socket.join(`order_${orderId}`)
    socket.emit("tracking_started", { orderId })
  })

  // Customer stops tracking order
  socket.on("stop_tracking", (data) => {
    const { orderId } = data
    socket.leave(`order_${orderId}`)
  })

  // Customer requests captain location
  socket.on("get_captain_location", async (data) => {
    try {
      const { orderId } = data

      const order = await Order.findById(orderId)
      if (!order || order.customer.toString() !== socket.userId) {
        return socket.emit("error", { message: "Order not found or unauthorized" })
      }

      if (order.captain) {
        const location = captainLocations.get(order.captain.toString())
        if (location) {
          socket.emit("captain_location_update", {
            orderId,
            location,
            timestamp: location.timestamp,
          })
        }
      }
    } catch (error) {
      socket.emit("error", { message: "Failed to get captain location" })
    }
  })
}

const handleCommonEvents = (socket, io) => {
  // Ping/pong for connection health
  socket.on("ping", () => {
    socket.emit("pong")
  })

  // Join admin room (for admin users)
  socket.on("join_admin", () => {
    if (socket.userRole === "admin") {
      socket.join("admin_room")
    }
  })
}

const updateCaptainStatus = async (userId, isOnline) => {
  try {
    await Captain.findOneAndUpdate({ user: userId }, { "availability.isOnline": isOnline })
  } catch (error) {
    console.error("Failed to update captain status:", error)
  }
}

// Utility function to emit to specific user
const emitToUser = (io, userId, event, data) => {
  io.to(`user_${userId}`).emit(event, data)
}

// Utility function to broadcast new order to available captains
const broadcastOrderToCaptains = async (io, order) => {
  try {
    // Find available captains near the restaurant
    const availableCaptains = await Captain.find({
      "availability.isOnline": true,
      "availability.isAvailable": true,
      "availability.currentOrders": { $lt: 3 }, // Max 3 orders per captain
      isApproved: true,
      isActive: true,
    }).populate("user")

    // Emit to all available captains
    availableCaptains.forEach((captain) => {
      const connection = activeConnections.get(captain.user._id.toString())
      if (connection) {
        io.to(`user_${captain.user._id}`).emit("new_order_available", {
          orderId: order._id,
          orderNumber: order.orderNumber,
          restaurant: order.restaurant,
          deliveryAddress: order.deliveryAddress,
          total: order.pricing.total,
          estimatedTime: order.estimatedDeliveryTime,
        })
      }
    })
  } catch (error) {
    console.error("Failed to broadcast order to captains:", error)
  }
}

module.exports = socketHandler
module.exports.emitToUser = emitToUser
module.exports.broadcastOrderToCaptains = broadcastOrderToCaptains
