import { Router } from 'express';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
const router = Router();

router.get('/', auth, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.userId } }).select('name email avatar lastSeen').sort({ name: 1 });
  res.json(users.map(u => ({ id: u._id, name: u.name, email: u.email, avatar: u.avatar, lastSeen: u.lastSeen })));
});
export default router;
