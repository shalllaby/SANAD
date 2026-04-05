const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// SANAD Chatbot placeholder responses (Arabic)
const PLACEHOLDER_RESPONSES = [
    'سناد بيسمعك! 🤖 الخدمة دي هتتفعل قريباً.',
    'أنا سناد، مساعدك الشخصي. هكون معاك قريباً! 💙',
    'شكراً على رسالتك! فريقنا بيشتغل على أكتيفيشن الخدمة.',
    'سناد في طريقه إليك! خلي بالك من صحتك. 🌙'
];

// ─── Send Message ─────────────────────────────────────────────────────────────
router.post('/message', authenticate, async (req, res) => {
    try {
        const { content } = req.body;

        if (!content || content.trim() === '') {
            return res.status(400).json({ error: 'الرسالة فارغة' });
        }

        // Save user message
        const userMessage = await prisma.chatMessage.create({
            data: {
                userId: req.user.id,
                role: 'USER',
                content: content.trim()
            }
        });

        // ── AI INTEGRATION (CareCompanion All-in-One Server) ───────────────────────
        const AI_SERVER_URL = "https://unslakable-unplacid-anton.ngrok-free.dev/chat";
        
        let botReply = 'عفواً، السيرفر الذكي غير متصل الآن. حاول تاني! 😔';
        let isPlaceholder = true;

        try {
            const aiResponse = await fetch(AI_SERVER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: content.trim() })
            });

            if (aiResponse.ok) {
                const data = await aiResponse.json();
                if (data.success && data.reply) {
                    botReply = data.reply;
                    isPlaceholder = false;
                }
            }
        } catch (err) {
            console.error('AI Service Error:', err.message);
            // Fallback to placeholder if AI is down
            botReply = PLACEHOLDER_RESPONSES[Math.floor(Math.random() * PLACEHOLDER_RESPONSES.length)];
        }
        // ────────────────────────────────────────────────────────────────────────

        // Save bot response
        const botMessage = await prisma.chatMessage.create({
            data: {
                userId: req.user.id,
                role: 'BOT',
                content: botReply
            }
        });

        res.json({
            userMessage,
            botMessage,
            isPlaceholder
        });

    } catch (err) {
        console.error('Chat error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Get Chat History ─────────────────────────────────────────────────────────
router.get('/history', authenticate, async (req, res) => {
    try {
        const { limit = 50 } = req.query;

        const messages = await prisma.chatMessage.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'asc' },
            take: parseInt(limit)
        });

        res.json({ messages });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Clear Chat History ───────────────────────────────────────────────────────
router.delete('/history', authenticate, async (req, res) => {
    try {
        await prisma.chatMessage.deleteMany({ where: { userId: req.user.id } });
        res.json({ message: 'تم مسح المحادثة' });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

module.exports = router;
