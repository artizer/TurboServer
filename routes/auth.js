const express = require("express")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const User = require("../models/User")
const Captain = require("../models/Captain")

const router = express.Router()

// Generate JWT token
const generateToken = (userId, role) => {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET || "turbo-delivery-secret", { expiresIn: "30d" })
}

// Generate OTP (simulation)
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Store OTPs temporarily (in production, use Redis)
const otpStore = new Map()

// Send OTP (simulation)
router.post("/send-otp", async (req, res) => {
  try {
    const { phoneNumber } = req.body

    if (!phoneNumber) {
      return res.status(400).json({ message: "Phone number is required" })
    }

    // Generate OTP
    const otp = generateOTP()

    // Store OTP with expiration (5 minutes)
    otpStore.set(phoneNumber, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    })

    // In production, send SMS via Twilio, AWS SNS, etc.
    console.log(`📱 OTP for ${phoneNumber}: ${otp}`)

    res.json({
      message: "OTP sent successfully",
      // In development, return OTP for testing
      ...(process.env.NODE_ENV === "development" && { otp }),
    })
  } catch (error) {
    console.error("Send OTP error:", error)
    res.status(500).json({ message: "Failed to send OTP" })
  }
})

// Verify OTP and register/login user
router.post("/verify-otp", async (req, res) => {
  try {
    const { phoneNumber, otp, username, profileImage, role = "customer" } = req.body

    if (!phoneNumber || !otp) {
      return res.status(400).json({ message: "Phone number and OTP are required" })
    }

    // Verify OTP
    const storedOTP = otpStore.get(phoneNumber)
    if (!storedOTP || storedOTP.otp !== otp || Date.now() > storedOTP.expiresAt) {
      return res.status(400).json({ message: "Invalid or expired OTP" })
    }

    // Remove used OTP
    otpStore.delete(phoneNumber)

    // Check if user exists
    let user = await User.findOne({ phoneNumber })

    if (user) {
      // Existing user - login
      const token = generateToken(user._id, user.role)

      res.json({
        message: "Login successful",
        token,
        user: {
          id: user._id,
          phoneNumber: user.phoneNumber,
          username: user.username,
          profileImage: user.profileImage,
          role: user.role,
          isVerified: user.isVerified,
        },
      })
    } else {
      // New user - register
      if (!username) {
        return res.status(400).json({ message: "Username is required for new users" })
      }

      user = new User({
        phoneNumber,
        username,
        profileImage,
        role,
        isVerified: true,
      })

      await user.save()

      // If registering as captain, create captain profile
      if (role === "captain") {
        const captain = new Captain({
          user: user._id,
          vehicleInfo: {
            type: "motorcycle", // default
          },
        })
        await captain.save()
      }

      const token = generateToken(user._id, user.role)

      res.status(201).json({
        message: "Registration successful",
        token,
        user: {
          id: user._id,
          phoneNumber: user.phoneNumber,
          username: user.username,
          profileImage: user.profileImage,
          role: user.role,
          isVerified: user.isVerified,
        },
      })
    }
  } catch (error) {
    console.error("Verify OTP error:", error)
    res.status(500).json({ message: "Authentication failed" })
  }
})

// Refresh token
router.post("/refresh-token", async (req, res) => {
  try {
    const { token } = req.body

    if (!token) {
      return res.status(400).json({ message: "Token is required" })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "turbo-delivery-secret")
    const user = await User.findById(decoded.userId)

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    const newToken = generateToken(user._id, user.role)

    res.json({
      message: "Token refreshed successfully",
      token: newToken,
    })
  } catch (error) {
    console.error("Refresh token error:", error)
    res.status(401).json({ message: "Invalid token" })
  }
})

module.exports = router
