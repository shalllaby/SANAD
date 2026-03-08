const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
    try {
        const monitors = await prisma.user.findMany({ where: { role: 'MONITOR' } });
        if (!monitors.length) return console.log('No monitors found');
        const monitor = monitors[0];

        const connections = await prisma.connection.findMany({ where: { monitorId: monitor.id, status: 'ACTIVE' } });
        if (!connections.length) return console.log('No active connections for monitor');
        const elderId = connections[0].elderId;

        // Simulate calendar event creation
        const event = await prisma.calendarEvent.create({
            data: {
                title: 'Test Event',
                description: 'test',
                date: '2026-03-08',
                time: '15:00',
                type: 'CUSTOM',
                repeatRule: 'ONCE',
                monitorId: monitor.id,
                elderId
            }
        });
        console.log('Event created:', event);

        const rem = await prisma.reminder.create({
            data: {
                id: event.id,
                title: 'Test Event',
                description: 'test',
                type: 'APPOINTMENT',
                scheduledTime: '15:00',
                repeatRule: 'CALENDAR_EVENT',
                scheduledDays: JSON.stringify(['2026-03-08']),
                isActive: true,
                monitorId: monitor.id,
                elderId
            }
        });
        console.log('Reminder created:', rem);
    } catch (e) {
        console.error('ERROR:', e);
    } finally {
        await prisma.$disconnect();
    }
}
test();
