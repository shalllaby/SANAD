const { v4: uuidv4 } = require('uuid');

/**
 * Generate a random alphanumeric code of given length.
 * Used for connection codes (e.g., ABX829).
 */
const generateCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars: 0,O,1,I
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
};

/**
 * Generate a full UUID (for other purposes).
 */
const generateId = () => uuidv4();

/**
 * Get current time + N minutes as Date object.
 */
const minutesFromNow = (minutes) => {
    return new Date(Date.now() + minutes * 60 * 1000);
};

/**
 * Convert HH:MM string to today's Date object.
 * Returns the Date if today, or tomorrow if time already passed.
 */
const parseScheduledTime = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const now = new Date();
    const scheduled = new Date();
    scheduled.setHours(hours, minutes, 0, 0);
    if (scheduled <= now) {
        // Schedule for tomorrow
        scheduled.setDate(scheduled.getDate() + 1);
    }
    return scheduled;
};

/**
 * Check if a time string (HH:MM) is due within the last minute.
 */
const isTimeDue = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const now = new Date();
    return now.getHours() === hours && now.getMinutes() === minutes;
};

module.exports = { generateCode, generateId, minutesFromNow, parseScheduledTime, isTimeDue };
