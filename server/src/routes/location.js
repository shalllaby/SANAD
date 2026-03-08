/**
 * SANAD - سند | Elder Location Tracking
 */
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ─── Update Location (Elder) ──────────────────────────────────────────────────
router.post('/update', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const { latitude, longitude, accuracy } = req.body;

        if (latitude == null || longitude == null) {
            return res.status(400).json({ error: 'الإحداثيات مطلوبة' });
        }

        const location = await prisma.elderLocation.create({
            data: {
                elderId: req.user.id,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                accuracy: accuracy ? parseFloat(accuracy) : null
            }
        });

        res.status(201).json({ message: 'تم تحديث الموقع', location });
    } catch (err) {
        console.error('Location update error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Get Latest Elder Location (Monitor) ──────────────────────────────────────
router.get('/elder/:elderId', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const { elderId } = req.params;

        // Verify access
        const connection = await prisma.connection.findFirst({
            where: { monitorId: req.user.id, elderId, status: 'ACTIVE' }
        });
        if (!connection) return res.status(403).json({ error: 'مش مرتبط بكبير السن ده' });

        const location = await prisma.elderLocation.findFirst({
            where: { elderId },
            orderBy: { createdAt: 'desc' }
        });

        if (!location) {
            return res.json({ location: null, message: 'لا يوجد موقع مُسجل لكبير السن بعد' });
        }

        res.json({ location });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

module.exports = router;
