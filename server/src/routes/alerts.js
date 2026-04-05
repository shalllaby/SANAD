const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole, verifyApiKey } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ─── Create Alert (External AI Systems via API Key) ────────────────────────────
router.post('/', verifyApiKey, async (req, res) => {
    try {
        const { elderId, type, message, severity, source, metadata } = req.body;

        if (!elderId || !type || !message) {
            return res.status(400).json({ error: 'elderId و type و message مطلوبين' });
        }

        // Verify elder exists
        const elder = await prisma.user.findUnique({
            where: { id: elderId, role: 'ELDER' },
            select: { id: true, name: true }
        });

        if (!elder) {
            return res.status(404).json({ error: 'كبير السن ده مش موجود في النظام' });
        }

        const alert = await prisma.alert.create({
            data: {
                elderId,
                type: type.toUpperCase(),
                message,
                severity: severity || 'HIGH',
                source: source || 'SYSTEM',
                metadata: metadata ? JSON.stringify(metadata) : null
            }
        });

        console.log(`🚨 New Alert: [${alert.type}] for elder ${elder.name}: ${message}`);

        res.status(201).json({
            message: 'تم استلام التنبيه بنجاح',
            alert
        });
    } catch (err) {
        console.error('Create alert error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Manual Alert from Monitor ────────────────────────────────────────────────
router.post('/manual', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const { elderId, type, message, severity } = req.body;

        if (!elderId || !message) {
            return res.status(400).json({ error: 'كبير السن والرسالة مطلوبين' });
        }

        // Verify monitor has access to elder
        const connection = await prisma.connection.findFirst({
            where: { monitorId: req.user.id, elderId, status: 'ACTIVE' }
        });
        if (!connection) return res.status(403).json({ error: 'مش مرتبط بكبير السن ده' });

        const alert = await prisma.alert.create({
            data: {
                elderId,
                type: type || 'MANUAL',
                message,
                severity: severity || 'MEDIUM',
                source: 'MANUAL'
            }
        });

        res.status(201).json({ message: 'تم إرسال التنبيه', alert });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Emergency Alert from Elder ───────────────────────────────────────────────
router.post('/emergency', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const { message, latitude, longitude } = req.body;

        const metadata = {};
        if (latitude != null && longitude != null) {
            metadata.latitude = parseFloat(latitude);
            metadata.longitude = parseFloat(longitude);
            metadata.timestamp = new Date().toISOString();
        }

        const alert = await prisma.alert.create({
            data: {
                elderId: req.user.id,
                type: 'EMERGENCY',
                message: message || `🚨 ${req.user.name} يحتاج مساعدة فورية!`,
                severity: 'CRITICAL',
                source: 'ELDER_EMERGENCY',
                metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null
            }
        });

        console.log(`🚨🚨 EMERGENCY from elder ${req.user.name}: ${alert.message}`);

        res.status(201).json({
            message: 'تم إرسال إنذار الطوارئ — المسؤول هيتبلغ فوراً',
            alert
        });
    } catch (err) {
        console.error('Emergency alert error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Save Health AI Assessment (Elder) ─────────────────────────────────────────
router.post('/health-assessment', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const { prediction, message, severity, metadata } = req.body;

        const alert = await prisma.alert.create({
            data: {
                elderId: req.user.id,
                type: 'HEALTH',
                message: message || `تقييم صحي جديد: ${prediction}`,
                severity: severity || 'MEDIUM',
                source: 'HEALTH_PREDICTION',
                metadata: metadata ? JSON.stringify(metadata) : null
            }
        });

        res.status(201).json({ message: 'تم حفظ التقييم بنجاح', alert });
    } catch (err) {
        console.error('Health assessment save error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Get Alerts (Monitor) ─────────────────────────────────────────────────────
router.get('/', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const { unreadOnly, elderId: elderFilter } = req.query;

        // Get all connected elders
        const connections = await prisma.connection.findMany({
            where: { monitorId: req.user.id, status: 'ACTIVE' },
            select: { elderId: true }
        });
        const elderIds = connections.map(c => c.elderId).filter(Boolean);

        const where = {
            elderId: { in: elderIds.length > 0 ? elderIds : [''] },
            ...(unreadOnly === 'true' && { isRead: false }),
            ...(elderFilter && { elderId: elderFilter })
        };

        const alerts = await prisma.alert.findMany({
            where,
            include: {
                elder: { select: { name: true, id: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        });

        const unreadCount = alerts.filter(a => !a.isRead).length;

        res.json({ alerts, unreadCount });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Get Alerts for Elder (Elder dashboard) ────────────────────────────────────
router.get('/my-alerts', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const alerts = await prisma.alert.findMany({
            where: { elderId: req.user.id },
            orderBy: { createdAt: 'desc' },
            take: 20
        });

        res.json({ alerts });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Mark Alert as Read ────────────────────────────────────────────────────────
router.put('/:id/read', authenticate, async (req, res) => {
    try {
        const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
        if (!alert) return res.status(404).json({ error: 'التنبيه مش موجود' });

        await prisma.alert.update({
            where: { id: req.params.id },
            data: { isRead: true }
        });

        res.json({ message: 'تم قراءة التنبيه' });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Mark All Alerts as Read (Monitor) ────────────────────────────────────────
router.put('/read-all', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const connections = await prisma.connection.findMany({
            where: { monitorId: req.user.id, status: 'ACTIVE' },
            select: { elderId: true }
        });
        const elderIds = connections.map(c => c.elderId).filter(Boolean);

        await prisma.alert.updateMany({
            where: { elderId: { in: elderIds }, isRead: false },
            data: { isRead: true }
        });

        res.json({ message: 'تم قراءة كل التنبيهات' });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

module.exports = router;
