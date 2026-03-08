const express = require('express');
const QRCode = require('qrcode');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');
const { generateCode, minutesFromNow } = require('../utils/generateCode');

const router = express.Router();
const prisma = new PrismaClient();

// ─── Generate Connection (Monitor only) ──────────────────────────────────────
router.post('/generate', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        let code;
        let isUnique = false;

        // Ensure unique code
        while (!isUnique) {
            code = generateCode(6);
            const existing = await prisma.connection.findUnique({ where: { code } });
            if (!existing) isUnique = true;
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const connectUrl = `${baseUrl}/connect/${code}`;

        // Generate QR Code as base64 image
        const qrCodeDataUrl = await QRCode.toDataURL(connectUrl, {
            errorCorrectionLevel: 'H',
            margin: 2,
            color: { dark: '#2D3748', light: '#FFFFFF' },
            width: 300
        });

        // Store connection with 24-hour expiry
        const connection = await prisma.connection.create({
            data: {
                code,
                monitorId: req.user.id,
                status: 'PENDING',
                expiresAt: minutesFromNow(24 * 60) // 24 hours
            }
        });

        res.json({
            message: 'تم إنشاء رابط الربط بنجاح',
            code,
            connectUrl,
            qrCode: qrCodeDataUrl,
            expiresAt: connection.expiresAt
        });
    } catch (err) {
        console.error('Generate connection error:', err);
        res.status(500).json({ error: 'حصل خطأ في إنشاء الرابط' });
    }
});

// ─── Get Connection Info by Code (Elder opens the link) ───────────────────────
router.get('/info/:code', async (req, res) => {
    try {
        const { code } = req.params;

        const connection = await prisma.connection.findUnique({
            where: { code },
            include: {
                monitor: { select: { id: true, name: true, email: true } }
            }
        });

        if (!connection) {
            return res.status(404).json({ error: 'الكود ده مش موجود' });
        }

        if (connection.status === 'ACTIVE') {
            return res.status(409).json({ error: 'الكود ده اتستخدم قبل كده' });
        }

        if (new Date() > connection.expiresAt) {
            return res.status(410).json({ error: 'الكود ده انتهى — اطلب من المسؤول كود جديد' });
        }

        res.json({
            code: connection.code,
            monitor: connection.monitor,
            expiresAt: connection.expiresAt
        });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Accept Connection (Elder only) ───────────────────────────────────────────
router.post('/accept/:code', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const { code } = req.params;

        const connection = await prisma.connection.findUnique({
            where: { code },
            include: { monitor: { select: { id: true, name: true } } }
        });

        if (!connection) {
            return res.status(404).json({ error: 'الكود ده مش موجود' });
        }

        if (connection.status === 'ACTIVE') {
            return res.status(409).json({ error: 'الكود ده اتستخدم قبل كده' });
        }

        if (new Date() > connection.expiresAt) {
            return res.status(410).json({ error: 'الكود ده انتهى' });
        }

        // Check if elder is already connected to this monitor
        const existingActive = await prisma.connection.findFirst({
            where: { monitorId: connection.monitorId, elderId: req.user.id, status: 'ACTIVE' }
        });
        if (existingActive) {
            return res.status(409).json({ error: 'أنت مرتبط بالفعل مع المسؤول ده' });
        }

        const updated = await prisma.connection.update({
            where: { code },
            data: { elderId: req.user.id, status: 'ACTIVE' }
        });

        res.json({
            message: `تم الربط مع ${connection.monitor.name} بنجاح! 🎉`,
            connection: updated
        });
    } catch (err) {
        console.error('Accept connection error:', err);
        res.status(500).json({ error: 'حصل خطأ في الربط' });
    }
});

// ─── Reject Connection (Elder) ─────────────────────────────────────────────────
router.post('/reject/:code', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const { code } = req.params;

        await prisma.connection.update({
            where: { code },
            data: { status: 'REJECTED' }
        });

        res.json({ message: 'تم رفض الربط' });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── List Connected Elders (Monitor) ─────────────────────────────────────────
router.get('/my-elders', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const connections = await prisma.connection.findMany({
            where: { monitorId: req.user.id, status: 'ACTIVE' },
            include: {
                elder: {
                    select: { id: true, name: true, email: true, phone: true, createdAt: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ connections });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Get My Monitor (Elder) ───────────────────────────────────────────────────
router.get('/my-monitor', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const connection = await prisma.connection.findFirst({
            where: { elderId: req.user.id, status: 'ACTIVE' },
            include: {
                monitor: { select: { id: true, name: true, email: true, phone: true } }
            }
        });

        res.json({ connection });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Delete Connection ─────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const connection = await prisma.connection.findUnique({ where: { id: req.params.id } });
        if (!connection) return res.status(404).json({ error: 'الاتصال مش موجود' });

        // Only the monitor or the elder can delete their connection
        if (connection.monitorId !== req.user.id && connection.elderId !== req.user.id) {
            return res.status(403).json({ error: 'مش مسموحلك تعمل ده' });
        }

        await prisma.connection.delete({ where: { id: req.params.id } });
        res.json({ message: 'تم إلغاء الربط' });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

module.exports = router;
