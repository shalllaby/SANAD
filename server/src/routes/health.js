const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole, verifyApiKey } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ─── Get Latest Health Data for Elder (Monitor view) ──────────────────────────
router.get('/elder/:elderId', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const { elderId } = req.params;
        const { days = 7 } = req.query;

        // Verify access
        const connection = await prisma.connection.findFirst({
            where: { monitorId: req.user.id, elderId, status: 'ACTIVE' }
        });
        if (!connection) return res.status(403).json({ error: 'مش مرتبط بكبير السن ده' });

        const since = new Date();
        since.setDate(since.getDate() - parseInt(days));

        const records = await prisma.healthData.findMany({
            where: { elderId, recordedAt: { gte: since } },
            orderBy: { recordedAt: 'desc' },
            take: 200
        });

        // Latest vitals
        const latest = records[0] || null;

        // Daily averages for charting
        const dailyMap = {};
        records.forEach(r => {
            const day = r.recordedAt.toISOString().split('T')[0];
            if (!dailyMap[day]) dailyMap[day] = { heartRates: [], oxygens: [], steps: [] };
            if (r.heartRate) dailyMap[day].heartRates.push(r.heartRate);
            if (r.bloodOxygen) dailyMap[day].oxygens.push(r.bloodOxygen);
            if (r.steps) dailyMap[day].steps.push(r.steps);
        });

        const dailyAverages = Object.entries(dailyMap).map(([date, vals]) => ({
            date,
            avgHeartRate: vals.heartRates.length ? (vals.heartRates.reduce((a, b) => a + b) / vals.heartRates.length).toFixed(1) : null,
            avgOxygen: vals.oxygens.length ? (vals.oxygens.reduce((a, b) => a + b) / vals.oxygens.length).toFixed(1) : null,
            totalSteps: vals.steps.length ? vals.steps.reduce((a, b) => a + b) : null
        })).sort((a, b) => a.date.localeCompare(b.date));

        res.json({ latest, dailyAverages, records: records.slice(0, 50) });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Push Health Data Directly (via API Key) ───────────────────────────────────
router.post('/', verifyApiKey, async (req, res) => {
    try {
        const { elderId, heartRate, bloodPressure, bloodOxygen, steps, moodScore, moodLabel, source, recordedAt } = req.body;

        if (!elderId) return res.status(400).json({ error: 'elderId مطلوب' });

        const record = await prisma.healthData.create({
            data: {
                elderId,
                heartRate: heartRate || null,
                bloodPressure: bloodPressure || null,
                bloodOxygen: bloodOxygen || null,
                steps: steps || null,
                moodScore: moodScore || null,
                moodLabel: moodLabel || null,
                source: source || 'API',
                recordedAt: recordedAt ? new Date(recordedAt) : new Date()
            }
        });

        res.status(201).json({ message: 'تم تسجيل البيانات الصحية', record });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

module.exports = router;
