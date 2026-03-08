const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Helper: verify monitor has access to elder
const verifyMonitorElderAccess = async (monitorId, elderId) => {
    const connection = await prisma.connection.findFirst({
        where: { monitorId, elderId, status: 'ACTIVE' }
    });
    return !!connection;
};

// ─── Create Reminder (Monitor only) ──────────────────────────────────────────
router.post('/', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const { elderId, title, description, type, scheduledTime, repeatRule, scheduledDays } = req.body;

        if (!elderId || !title || !scheduledTime) {
            return res.status(400).json({ error: 'كبير السن والعنوان والوقت مطلوبين' });
        }

        // Validate time format HH:MM
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(scheduledTime)) {
            return res.status(400).json({ error: 'صيغة الوقت غلط — استخدم HH:MM' });
        }

        // Verify access
        const hasAccess = await verifyMonitorElderAccess(req.user.id, elderId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'مش مرتبط بكبير السن ده' });
        }

        const reminder = await prisma.reminder.create({
            data: {
                title,
                description: description || null,
                type: type || 'CUSTOM',
                scheduledTime,
                repeatRule: repeatRule || 'DAILY',
                scheduledDays: scheduledDays ? JSON.stringify(scheduledDays) : null,
                monitorId: req.user.id,
                elderId,
                isActive: true
            },
            include: {
                elder: { select: { name: true } }
            }
        });

        res.status(201).json({
            message: `تم إنشاء التذكير "${title}" بنجاح`,
            reminder
        });
    } catch (err) {
        console.error('Create reminder error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── List Reminders for Elder (Monitor view) ──────────────────────────────────
router.get('/elder/:elderId', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const { elderId } = req.params;

        const hasAccess = await verifyMonitorElderAccess(req.user.id, elderId);
        if (!hasAccess) return res.status(403).json({ error: 'مش مرتبط بكبير السن ده' });

        const reminders = await prisma.reminder.findMany({
            where: {
                elderId,
                monitorId: req.user.id,
                repeatRule: { not: 'CALENDAR_EVENT' }
            },
            orderBy: [{ isActive: 'desc' }, { scheduledTime: 'asc' }]
        });

        res.json({ reminders });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Get Active Reminders for Elder (Elder view) ───────────────────────────────
router.get('/active', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const now = new Date();

        // Get pending reminder logs for today
        const logs = await prisma.reminderLog.findMany({
            where: {
                reminder: { elderId: req.user.id, isActive: true },
                status: { in: ['PENDING', 'SNOOZED'] },
                OR: [
                    { snoozeUntil: null },
                    { snoozeUntil: { lte: now } }
                ]
            },
            include: {
                reminder: {
                    select: { id: true, title: true, description: true, type: true, scheduledTime: true }
                }
            },
            orderBy: { triggeredAt: 'desc' }
        });

        res.json({ logs });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Get Today's Schedule for Elder ───────────────────────────────────────────
router.get('/schedule', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const reminders = await prisma.reminder.findMany({
            where: {
                elderId: req.user.id,
                isActive: true,
                repeatRule: { not: 'CALENDAR_EVENT' }
            },
            orderBy: { scheduledTime: 'asc' }
        });

        // Get today's logs
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayLogs = await prisma.reminderLog.findMany({
            where: {
                reminder: { elderId: req.user.id },
                triggeredAt: { gte: today, lt: tomorrow }
            },
            include: { reminder: true }
        });

        res.json({ reminders, todayLogs });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Update Reminder (Monitor) ────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const reminder = await prisma.reminder.findUnique({ where: { id: req.params.id } });
        if (!reminder) return res.status(404).json({ error: 'التذكير مش موجود' });
        if (reminder.monitorId !== req.user.id) return res.status(403).json({ error: 'مش مسموحلك' });

        const { title, description, type, scheduledTime, repeatRule, scheduledDays, isActive } = req.body;

        const updated = await prisma.reminder.update({
            where: { id: req.params.id },
            data: {
                title: title || undefined,
                description: description !== undefined ? description : undefined,
                type: type || undefined,
                scheduledTime: scheduledTime || undefined,
                repeatRule: repeatRule || undefined,
                scheduledDays: scheduledDays !== undefined ? JSON.stringify(scheduledDays) : undefined,
                isActive: isActive !== undefined ? isActive : undefined
            }
        });

        res.json({ message: 'تم تعديل التذكير', reminder: updated });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Delete Reminder (Monitor) ────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const reminder = await prisma.reminder.findUnique({ where: { id: req.params.id } });
        if (!reminder) return res.status(404).json({ error: 'التذكير مش موجود' });
        if (reminder.monitorId !== req.user.id) return res.status(403).json({ error: 'مش مسموحلك' });

        await prisma.reminder.delete({ where: { id: req.params.id } });
        res.json({ message: 'تم حذف التذكير' });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Confirm Reminder Log (Elder) ─────────────────────────────────────────────
router.post('/log/:logId/confirm', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const log = await prisma.reminderLog.findUnique({
            where: { id: req.params.logId },
            include: { reminder: true }
        });

        if (!log) return res.status(404).json({ error: 'التذكير مش موجود' });
        if (log.reminder.elderId !== req.user.id) return res.status(403).json({ error: 'مش مسموحلك' });

        const updated = await prisma.reminderLog.update({
            where: { id: req.params.logId },
            data: { status: 'CONFIRMED', respondedAt: new Date() }
        });

        res.json({ message: 'تم تسجيل الاستجابة ✅', log: updated });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Snooze Reminder Log (Elder) ──────────────────────────────────────────────
router.post('/log/:logId/snooze', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const { minutes = 15 } = req.body;
        const log = await prisma.reminderLog.findUnique({
            where: { id: req.params.logId },
            include: { reminder: true }
        });

        if (!log) return res.status(404).json({ error: 'التذكير مش موجود' });
        if (log.reminder.elderId !== req.user.id) return res.status(403).json({ error: 'مش مسموحلك' });

        const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);

        const updated = await prisma.reminderLog.update({
            where: { id: req.params.logId },
            data: { status: 'SNOOZED', snoozeUntil }
        });

        res.json({ message: `هنذكرك بعد ${minutes} دقيقة ⏰`, log: updated });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Reminder History (Monitor view) ─────────────────────────────────────────
router.get('/history/:elderId', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const { elderId } = req.params;
        const { days = 7 } = req.query;

        const hasAccess = await verifyMonitorElderAccess(req.user.id, elderId);
        if (!hasAccess) return res.status(403).json({ error: 'مش مرتبط بكبير السن ده' });

        const since = new Date();
        since.setDate(since.getDate() - parseInt(days));

        const logs = await prisma.reminderLog.findMany({
            where: {
                reminder: { elderId },
                triggeredAt: { gte: since }
            },
            include: {
                reminder: { select: { title: true, type: true, scheduledTime: true } }
            },
            orderBy: { triggeredAt: 'desc' }
        });

        // Compile stats
        const stats = {
            total: logs.length,
            confirmed: logs.filter(l => l.status === 'CONFIRMED').length,
            missed: logs.filter(l => l.status === 'MISSED').length,
            snoozed: logs.filter(l => l.status === 'SNOOZED').length,
            pending: logs.filter(l => l.status === 'PENDING').length
        };

        res.json({ logs, stats });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

module.exports = router;
