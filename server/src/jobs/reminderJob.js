const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Reminder Cron Job
 * Runs every minute to:
 * 1. Trigger due reminders by creating ReminderLog entries
 * 2. Mark old PENDING reminders as MISSED (after 30 minutes)
 */
const startReminderJob = () => {
    // Run every minute
    cron.schedule('* * * * *', async () => {
        const now = new Date();
        const currentHour = now.getHours().toString().padStart(2, '0');
        const currentMinute = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentHour}:${currentMinute}`;
        const currentDay = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][now.getDay()];

        try {
            // ── 1. Find due active reminders ─────────────────────────────────────
            const dueReminders = await prisma.reminder.findMany({
                where: {
                    isActive: true,
                    scheduledTime: currentTime,
                    repeatRule: { in: ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE', 'CALENDAR_EVENT'] }
                }
            });

            for (const reminder of dueReminders) {
                // Check if we already triggered this reminder today
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);

                const existingToday = await prisma.reminderLog.findFirst({
                    where: {
                        reminderId: reminder.id,
                        triggeredAt: { gte: today, lt: tomorrow }
                    }
                });

                if (existingToday) continue; // Already triggered today

                // For weekly reminders, check current day matches
                if (reminder.repeatRule === 'WEEKLY' && reminder.scheduledDays) {
                    const days = JSON.parse(reminder.scheduledDays);
                    if (!days.includes(currentDay)) continue;
                }

                // For calendar events, check current date matches YYYY-MM-DD
                if (reminder.repeatRule === 'CALENDAR_EVENT' && reminder.scheduledDays) {
                    const dates = JSON.parse(reminder.scheduledDays);
                    const yyyy = today.getFullYear();
                    const mm = String(today.getMonth() + 1).padStart(2, '0');
                    const dd = String(today.getDate()).padStart(2, '0');
                    const localTodayStr = `${yyyy}-${mm}-${dd}`;
                    if (!dates.includes(localTodayStr)) continue;
                }

                // Create reminder log (triggers notification on elder's dash)
                await prisma.reminderLog.create({
                    data: {
                        reminderId: reminder.id,
                        status: 'PENDING',
                        triggeredAt: now
                    }
                });

                console.log(`⏰ Reminder triggered: "${reminder.title}" for elder ${reminder.elderId} at ${currentTime}`);

                // Deactivate ONCE reminders after triggering
                if (reminder.repeatRule === 'ONCE') {
                    await prisma.reminder.update({
                        where: { id: reminder.id },
                        data: { isActive: false }
                    });
                }
            }

            // ── 2. Mark stale PENDING reminders as MISSED ─────────────────────────
            const cutoffTime = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes ago

            const staleCount = await prisma.reminderLog.updateMany({
                where: {
                    status: 'PENDING',
                    triggeredAt: { lt: cutoffTime }
                },
                data: { status: 'MISSED' }
            });

            if (staleCount.count > 0) {
                console.log(`⚠️  Marked ${staleCount.count} reminder(s) as MISSED`);
            }

            // ── 3. Re-trigger snoozed reminders that are now due ──────────────────
            const snoozedDue = await prisma.reminderLog.findMany({
                where: {
                    status: 'SNOOZED',
                    snoozeUntil: { lte: now }
                }
            });

            for (const log of snoozedDue) {
                await prisma.reminderLog.update({
                    where: { id: log.id },
                    data: { status: 'PENDING', snoozeUntil: null }
                });
            }

            if (snoozedDue.length > 0) {
                console.log(`🔔 Re-activated ${snoozedDue.length} snoozed reminder(s)`);
            }

        } catch (err) {
            console.error('Cron job error:', err.message);
        }
    });

    console.log('⏰ Reminder scheduler started (running every minute)');
};

module.exports = { startReminderJob };

// Auto-start when required
startReminderJob();
