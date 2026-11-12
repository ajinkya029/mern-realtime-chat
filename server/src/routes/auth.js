import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = Router();
const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
});

router.post("/register", async (req, res) => {
  try {
    console.log("Registration request body:", {
      ...req.body,
      password: req.body?.password ? "Provided" : "Missing",
    });

    const { name, email, password } = req.body || {};

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      name.trim().length === 0 ||
      email.trim().length === 0 ||
      password.length < 8
    ) {
      return res.status(400).json({
        message:
          "Please provide name, email and password (minimum 8 characters).",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(409).json({
        message: "An account with this email already exists",
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: await bcrypt.hash(password, 12),
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      token,
      user: publicUser(user),
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Could not create account" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const user = await User.findOne({
      email: req.body.email?.toLowerCase().trim(),
    }).select("+password");
    if (
      !user ||
      !(await bcrypt.compare(req.body.password || "", user.password))
    )
      return res.status(401).json({ message: "Incorrect email or password" });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ token, user: publicUser(user) });
  } catch {
    res.status(500).json({ message: "Could not log in" });
  }
});

export default router;
