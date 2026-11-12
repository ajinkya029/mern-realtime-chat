import jwt from 'jsonwebtoken';
import User from './models/User.js';
import Conversation from './models/Conversation.js';
import Message from './models/Message.js';

export function configureSocket(io) {
  const online = new Map(); // userId -> Set(socketId)

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      socket.userId = jwt.verify(token, process.env.JWT_SECRET).id;
      next();
    } catch { next(new Error('Invalid socket token')); }
  });

  io.on('connection', socket => {
    const userId = String(socket.userId);
    if (!online.has(userId)) online.set(userId, new Set());
    online.get(userId).add(socket.id);
    socket.join(userId);
    io.emit('online_users', [...online.keys()]);

    socket.on('join', async conversationId => {
      const allowed = await Conversation.exists({ _id: conversationId, participants: socket.userId });
      if (allowed) socket.join(String(conversationId));
    });

    socket.on('private_message', async ({ conversationId, text }) => {
      try {
        const clean = String(text || '').trim();
        if (!clean || clean.length > 5000) throw new Error('Message must be 1–5000 characters');
        const conversation = await Conversation.findOne({ _id: conversationId, participants: socket.userId });
        if (!conversation) throw new Error('Conversation not found');
        const message = await Message.create({
          conversation: conversationId, sender: socket.userId, text: clean, readBy: [socket.userId]
        });
        await Conversation.findByIdAndUpdate(conversationId, { lastMessage: message._id, updatedAt: new Date() });
        const populated = await message.populate('sender', 'name');
        const payload = {
          id: populated._id, conversationId, text: populated.text,
          sender: { id: populated.sender._id, name: populated.sender.name },
          readBy: populated.readBy, createdAt: populated.createdAt
        };
        io.to(String(conversationId)).emit('receive_message', payload);
        for (const participant of conversation.participants) {
          io.to(String(participant)).emit('conversation_updated', String(conversationId));
        }
      } catch (error) { socket.emit('message_error', error.message || 'Message could not be sent'); }
    });

    socket.on('typing', async ({ conversationId }) => {
      const allowed = await Conversation.exists({ _id: conversationId, participants: socket.userId });
      if (allowed) socket.to(String(conversationId)).emit('typing', { conversationId, userId });
    });
    socket.on('stop_typing', ({ conversationId }) => {
      socket.to(String(conversationId)).emit('stop_typing', { conversationId, userId });
    });

    socket.on('disconnect', async () => {
      const sockets = online.get(userId);
      sockets?.delete(socket.id);
      if (!sockets?.size) {
        online.delete(userId);
        await User.findByIdAndUpdate(userId, { lastSeen: new Date() });
      }
      io.emit('online_users', [...online.keys()]);
    });
  });
}
