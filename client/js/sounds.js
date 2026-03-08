/**
 * SANAD - سند | Audio Notification System
 * Uses Web Audio API to generate notification sounds programmatically.
 * No external sound files needed.
 */

let audioCtx = null;
let alarmIntervalId = null; // For persistent looping alarm

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

/**
 * Play a tone sequence
 */
function playTones(notes, type = 'sine', volume = 0.3) {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        notes.forEach(({ freq, duration, delay }) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = type;
            osc.frequency.value = freq;

            gain.gain.setValueAtTime(0, now + delay);
            gain.gain.linearRampToValueAtTime(volume, now + delay + 0.02);
            gain.gain.setValueAtTime(volume, now + delay + duration - 0.05);
            gain.gain.linearRampToValueAtTime(0, now + delay + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now + delay);
            osc.stop(now + delay + duration);
        });
    } catch (e) {
        console.log('Audio not available:', e.message);
    }
}

/**
 * 🔔 Reminder Sound — gentle ascending chime (single play)
 */
function playReminderSound() {
    playTones([
        { freq: 523, duration: 0.15, delay: 0 },
        { freq: 659, duration: 0.15, delay: 0.15 },
        { freq: 784, duration: 0.25, delay: 0.30 },
    ], 'sine', 0.25);
}

/**
 * 🚨 Alert / Emergency Sound — urgent alarm beeps (single play)
 */
function playAlertSound() {
    const beeps = [];
    for (let i = 0; i < 6; i++) {
        beeps.push({ freq: 880, duration: 0.12, delay: i * 0.25 });
        beeps.push({ freq: 660, duration: 0.12, delay: i * 0.25 + 0.12 });
    }
    playTones(beeps, 'square', 0.2);
}

/**
 * 💬 Message Sound — soft notification ping
 */
function playMessageSound() {
    playTones([
        { freq: 800, duration: 0.1, delay: 0 },
        { freq: 1000, duration: 0.15, delay: 0.12 },
    ], 'sine', 0.2);
}

/**
 * ⏰ PERSISTENT ALARM — Plays a loud, continuous alarm that DOES NOT stop
 * until stopAlarmLoop() is called. Used for medication/task reminders.
 *
 * Pattern: alternating high-low beeps for ~2.5s, repeated every 3s
 */
function startAlarmLoop() {
    // Don't start if already running
    if (alarmIntervalId) return;

    // Play immediately
    _playAlarmBurst();

    // Repeat every 3 seconds indefinitely
    alarmIntervalId = setInterval(() => {
        _playAlarmBurst();
    }, 3000);
}

/**
 * Stop the persistent alarm loop
 */
function stopAlarmLoop() {
    if (alarmIntervalId) {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
    }
}

/**
 * Internal: Play one burst of alarm tones (~2.5s)
 * Loud, attention-grabbing pattern: ascending → descending → ascending
 */
function _playAlarmBurst() {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;
        const vol = 0.4; // Louder than other sounds

        const pattern = [
            { freq: 880, duration: 0.18, delay: 0 },
            { freq: 1100, duration: 0.18, delay: 0.22 },
            { freq: 880, duration: 0.18, delay: 0.44 },
            { freq: 1100, duration: 0.18, delay: 0.66 },
            { freq: 660, duration: 0.18, delay: 0.88 },
            { freq: 880, duration: 0.18, delay: 1.10 },
            { freq: 1100, duration: 0.18, delay: 1.32 },
            { freq: 1320, duration: 0.30, delay: 1.54 },
        ];

        pattern.forEach(({ freq, duration, delay }) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'square';
            osc.frequency.value = freq;

            gain.gain.setValueAtTime(0, now + delay);
            gain.gain.linearRampToValueAtTime(vol, now + delay + 0.015);
            gain.gain.setValueAtTime(vol, now + delay + duration - 0.03);
            gain.gain.linearRampToValueAtTime(0, now + delay + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now + delay);
            osc.stop(now + delay + duration);
        });
    } catch (e) {
        console.log('Alarm burst error:', e.message);
    }
}

/**
 * Check if alarm is currently looping
 */
function isAlarmPlaying() {
    return alarmIntervalId !== null;
}

// Ensure audio context is ready after first user interaction
document.addEventListener('click', () => {
    try { getAudioContext(); } catch (e) { /* ignore */ }
}, { once: true });
