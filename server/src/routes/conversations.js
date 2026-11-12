import { Router } from 'express';
import mongoose from 'mongoose';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { auth } from '../middleware/auth.js';
const router = Router();

router.get('/', auth, async (req, res) => {
  const conversations = await Conversation.find({ participants: req.userId })
    .populate('participants', 'name email avatar lastSeen')
    .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'name' } })
    .sort({ updatedAt: -1 });
  res.json(conversations.map(c => ({
    id: c._id,
    participants: c.participants.map(p => ({ id: p._id, name: p.name, email: p.email, avatar: p.avatar, lastSeen: p.lastSeen })),
    lastMessage: c.lastMessage ? { text: c.lastMessage.text, senderId: c.lastMessage.sender?._id, createdAt: c.lastMessage.createdAt } : null,
    updatedAt: c.updatedAt
  })));
});

router.post('/', auth, async (req, res) => {
  const otherId = req.body.userId;
  if (!mongoose.isValidObjectId(otherId) || String(otherId) === String(req.userId))
    return res.status(400).json({ message: 'A valid other user is required' });
  let conversation = await Conversation.findOne({ participants: { $all: [req.userId, otherId], $size: 2 } });
  if (!conversation) conversation = await Conversation.create({ participants: [req.userId, otherId] });
  conversation = await conversation.populate('participants', 'name email avatar lastSeen');
  res.status(200).json({
    id: conversation._id,
    participants: conversation.participants.map(p => ({ id: p._id, name: p.name, email: p.email, avatar: p.avatar, lastSeen: p.lastSeen })),
    lastMessage: null, updatedAt: conversation.updatedAt
  });
});

router.get('/:id/messages', auth, async (req, res) => {
  const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.userId });
  if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
  const messages = await Message.find({ conversation: conversation._id })
    .populate('sender', 'name').sort({ createdAt: 1 }).limit(300);
  await Message.updateMany({ conversation: conversation._id, sender: { $ne: req.userId }, readBy: { $ne: req.userId } }, { $addToSet: { readBy: req.userId } });
  res.json(messages.map(m => ({
    id: m._id, conversationId: m.conversation, text: m.text,
    sender: { id: m.sender._id, name: m.sender.name }, readBy: m.readBy, createdAt: m.createdAt
  })));
});
export default router;
