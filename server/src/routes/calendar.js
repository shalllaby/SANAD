/**
 * SANAD - سند | Calendar Events
 */
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Helper: verify monitor has access to elder
const verifyAccess = async (monitorId, elderId) => {
    const conn = await prisma.connection.findFirst({
        where: { monitorId, elderId, status: 'ACTIVE' }
    });
    return !!conn;
};

// ─── Create Event (Monitor) ──────────────────────────────────────────────────
router.post('/', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const { elderId, title, description, date, time, type, repeatRule } = req.body;

        if (!elderId || !title || !date) {
            return res.status(400).json({ error: 'كبير السن والعنوان والتاريخ مطلوبين' });
        }

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'صيغة التاريخ غلط — استخدم YYYY-MM-DD' });
        }

        const hasAccess = await verifyAccess(req.user.id, elderId);
        if (!hasAccess) return res.status(403).json({ error: 'مش مرتبط بكبير السن ده' });

        const event = await prisma.calendarEvent.create({
            data: {
                title,
                description: description || null,
                date,
                time: time || null,
                type: type || 'CUSTOM',
                repeatRule: repeatRule || 'ONCE',
                monitorId: req.user.id,
                elderId
            }
        });

        if (time) {
            await prisma.reminder.create({
                data: {
                    id: event.id, // Same ID for implicit linking
                    title,
                    description: description || null,
                    type: type || 'APPOINTMENT',
                    scheduledTime: time,
                    repeatRule: 'CALENDAR_EVENT',
                    scheduledDays: JSON.stringify([date]),
                    isActive: true,
                    monitorId: req.user.id,
                    elderId
                }
            }).catch(e => console.error('Failed to create companion reminder:', e));
        }

        res.status(201).json({ message: 'تم إنشاء الحدث', event });
    } catch (err) {
        console.error('Create event error:', err);
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── List Events for Elder (Monitor) ──────────────────────────────────────────
router.get('/elder/:elderId', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const { elderId } = req.params;
        const { month } = req.query; // YYYY-MM

        const hasAccess = await verifyAccess(req.user.id, elderId);
        if (!hasAccess) return res.status(403).json({ error: 'مش مرتبط بكبير السن ده' });

        let where = { elderId };

        if (month && /^\d{4}-\d{2}$/.test(month)) {
            where.date = { startsWith: month };
        }

        const events = await prisma.calendarEvent.findMany({
            where,
            orderBy: [{ date: 'asc' }, { time: 'asc' }]
        });

        res.json({ events });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── My Events (Elder) ────────────────────────────────────────────────────────
router.get('/my-events', authenticate, requireRole('ELDER'), async (req, res) => {
    try {
        const { month } = req.query;

        let where = { elderId: req.user.id };

        if (month && /^\d{4}-\d{2}$/.test(month)) {
            where.date = { startsWith: month };
        }

        const events = await prisma.calendarEvent.findMany({
            where,
            orderBy: [{ date: 'asc' }, { time: 'asc' }]
        });

        res.json({ events });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Update Event (Monitor) ──────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const event = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
        if (!event) return res.status(404).json({ error: 'الحدث مش موجود' });
        if (event.monitorId !== req.user.id) return res.status(403).json({ error: 'مش مسموحلك' });

        const { title, description, date, time, type, repeatRule } = req.body;

        const updated = await prisma.calendarEvent.update({
            where: { id: req.params.id },
            data: {
                title: title || undefined,
                description: description !== undefined ? description : undefined,
                date: date || undefined,
                time: time !== undefined ? time : undefined,
                type: type || undefined,
                repeatRule: repeatRule || undefined
            }
        });

        // Sync companion Reminder
        if (time || updated.time) {
            const finalTime = time !== undefined ? time : updated.time;
            const finalDate = date || updated.date;

            if (finalTime) {
                const existingRem = await prisma.reminder.findUnique({ where: { id: req.params.id } });
                if (existingRem) {
                    await prisma.reminder.update({
                        where: { id: req.params.id },
                        data: {
                            title: title || undefined,
                            description: description !== undefined ? description : undefined,
                            type: type || undefined,
                            scheduledTime: finalTime,
                            scheduledDays: finalDate ? JSON.stringify([finalDate]) : undefined
                        }
                    });
                } else {
                    await prisma.reminder.create({
                        data: {
                            id: req.params.id,
                            title: title || updated.title,
                            description: description !== undefined ? description : updated.description,
                            type: type || updated.type || 'APPOINTMENT',
                            scheduledTime: finalTime,
                            repeatRule: 'CALENDAR_EVENT',
                            scheduledDays: JSON.stringify([finalDate]),
                            isActive: true,
                            monitorId: req.user.id,
                            elderId: event.elderId
                        }
                    });
                }
            } else {
                // time was explicitly cleared
                await prisma.reminder.delete({ where: { id: req.params.id } }).catch(() => null);
            }
        } else if (time === '' || time === null) {
            await prisma.reminder.delete({ where: { id: req.params.id } }).catch(() => null);
        }

        res.json({ message: 'تم تعديل الحدث', event: updated });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

// ─── Delete Event (Monitor) ──────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('MONITOR'), async (req, res) => {
    try {
        const event = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
        if (!event) return res.status(404).json({ error: 'الحدث مش موجود' });
        if (event.monitorId !== req.user.id) return res.status(403).json({ error: 'مش مسموحلك' });

        await prisma.calendarEvent.delete({ where: { id: req.params.id } });
        await prisma.reminder.delete({ where: { id: req.params.id } }).catch(() => null);

        res.json({ message: 'تم حذف الحدث' });
    } catch (err) {
        res.status(500).json({ error: 'حصل خطأ في السيرفر' });
    }
});

module.exports = router;
