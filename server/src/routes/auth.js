const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ─── Register ─────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role, phone } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({ error: 'الاسم والإيميل وكلمة السر والدور مطلوبين' });
        }

        if (!['ELDER', 'MONITOR'].includes(role)) {
            return res.status(400).json({ error: 'الدور يجب أن يكون ELDER أو MONITOR' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'الإيميل مش صحيح' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'كلمة السر لازم تكون 6 حروف على الأقل' });
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ error: 'الإيميل ده مستخدم بالفعل' });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await prisma.user.create({
            data: { name, email, passwordHash, role, phone: phone || null },
            select: { id: true, name: true, email: true, role: true, createdAt: true }
        });

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'تم إنشاء الحساب بنجاح',
            user,
            token
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'الإيميل وكلمة السر مطلوبين' });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: 'الإيميل أو كلمة السر غلط' });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: 'الإيميل أو كلمة السر غلط' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'أهلاً بيك!',
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
            token
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Get Current User ─────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, name: true, email: true, role: true, phone: true, createdAt: true }
        });
        res.json({ user });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Update Profile ───────────────────────────────────────────────────────────
router.put('/profile', authenticate, async (req, res) => {
    try {
        const { name, phone } = req.body;
        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: { name: name || undefined, phone: phone || undefined },
            select: { id: true, name: true, email: true, role: true, phone: true }
        });
        res.json({ message: 'تم تحديث البيانات', user });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

module.exports = router;
