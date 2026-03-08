/**
 * SANAD - سند | Direct Messaging (Elder ↔ Monitor)
 */
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Helper: check if two users are connected
const areConnected = async (userA, userB) => {
    const conn = await prisma.connection.findFirst({
        where: {
            status: 'ACTIVE',
            OR: [
                { monitorId: userA, elderId: userB },
                { monitorId: userB, elderId: userA }
            ]
        }
    });
    return !!conn;
};

// ─── Send Message ─────────────────────────────────────────────────────────────
router.post('/send', authenticate, async (req, res) => {
    try {
        const { receiverId, content } = req.body;

        if (!receiverId || !content || content.trim() === '') {
            return res.status(400).json({ error: 'المستلم والرسالة مطلوبين' });
        }

        // Verify connection exists
        const connected = await areConnected(req.user.id, receiverId);
        if (!connected) {
            return res.status(403).json({ error: 'مش مرتبط بالمستخدم ده' });
        }

        const message = await prisma.directMessage.create({
            data: {
                senderId: req.user.id,
                receiverId,
                content: content.trim()
            }
        });

        res.status(201).json({ message: 'تم إرسال الرسالة', data: message });
    } catch (err) {
        console.error('Send message error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Get Conversation ─────────────────────────────────────────────────────────
router.get('/conversation/:userId', authenticate, async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 50, before } = req.query;

        const connected = await areConnected(req.user.id, userId);
        if (!connected) {
            return res.status(403).json({ error: 'مش مرتبط بالمستخدم ده' });
        }

        const where = {
            OR: [
                { senderId: req.user.id, receiverId: userId },
                { senderId: userId, receiverId: req.user.id }
            ],
            ...(before && { createdAt: { lt: new Date(before) } })
        };

        const messages = await prisma.directMessage.findMany({
            where,
            orderBy: { createdAt: 'asc' },
            take: parseInt(limit)
        });

        res.json({ messages });
    } catch (err) {
        console.error('Conversation error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Mark Messages as Read ────────────────────────────────────────────────────
router.put('/read/:userId', authenticate, async (req, res) => {
    try {
        const { userId } = req.params;

        await prisma.directMessage.updateMany({
            where: {
                senderId: userId,
                receiverId: req.user.id,
                isRead: false
            },
            data: { isRead: true }
        });

        res.json({ message: 'تم قراءة الرسائل' });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Unread Count ─────────────────────────────────────────────────────────────
router.get('/unread-count', authenticate, async (req, res) => {
    try {
        const count = await prisma.directMessage.count({
            where: {
                receiverId: req.user.id,
                isRead: false
            }
        });

        res.json({ unreadCount: count });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

module.exports = router;
