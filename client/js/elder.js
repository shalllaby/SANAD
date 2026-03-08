/**
 * SANAD - سند | Elder Dashboard Logic
 * Features: persistent alarm reminders, emergency alerts, direct chat overlay,
 *           merged schedule, location tracking, calendar events
 */

let pollInterval = null;
let monitorInfo = null;
const typeEmojis = { MEDICINE: '💊', MEAL: '🍽️', WATER: '💧', EXERCISE: '🏃', APPOINTMENT: '📅', CUSTOM: '🔔' };
const eventTypeEmojis = { DOCTOR: '🏥', BANK: '🏦', VISIT: '👥', CUSTOM: '📌' };

// Track previous state for audio triggers
let prevReminderCount = -1;
let prevAlertCount = -1;
let prevMsgCount = -1;

// Alarm state
let activeAlarmLogId = null;
let chatOverlayOpen = false;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const user = requireAuth('ELDER');
    if (!user) return;

    document.getElementById('elderName').textContent = user.name.split(' ')[0];
    updateClock();
    setInterval(updateClock, 1000);

    // Wire alarm overlay buttons
    document.getElementById('alarmConfirmBtn').addEventListener('click', () => confirmAlarmReminder());
    document.getElementById('alarmSnoozeBtn').addEventListener('click', () => snoozeAlarmReminder());

    await loadMonitorInfo();
    await Promise.all([loadActiveReminders(), loadTodaySchedule(), loadAlerts()]);

    // Start location tracking
    startLocationTracking();

    // Poll every 12s for new reminders, alerts, messages
    pollInterval = setInterval(async () => {
        await loadActiveReminders();
        await loadAlerts();
        if (chatOverlayOpen) await loadDirectMessages();
        await checkUnreadMessages();
    }, 12000);
});

function updateClock() {
    const el = document.getElementById('currentTime');
    if (el) {
        el.textContent = new Date().toLocaleString('ar-EG', { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: true });
    }
}

// ─── Monitor Info ─────────────────────────────────────────────────────────────
async function loadMonitorInfo() {
    try {
        const data = await api.connections.myMonitor();
        if (data.connection && data.connection.monitor) {
            monitorInfo = data.connection.monitor;
            document.getElementById('chatMonitorName').textContent = monitorInfo.name;
        }
    } catch (err) {
        console.log('No monitor connected:', err.message);
    }
}

// ─── Emergency Alert ──────────────────────────────────────────────────────────
async function sendEmergency() {
    const btn = document.getElementById('emergencyBtn');
    if (!confirm('هتبعت إنذار طوارئ للمسؤول — متأكد؟')) return;

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> جاري الإرسال...';

    try {
        let latitude = null, longitude = null;
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: true });
            });
            latitude = pos.coords.latitude;
            longitude = pos.coords.longitude;
        } catch (geoErr) {
            console.log('Location unavailable:', geoErr.message);
        }

        await api.alerts.emergency({ latitude, longitude });

        if (typeof playAlertSound === 'function') playAlertSound();
        showToast('🚨 تم إرسال إنذار الطوارئ — المسؤول هيتبلغ فوراً', 'error', 6000);

        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '<span class="icon">🚨</span><span>أنا في خطر!</span>';
        }, 30000);
    } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<span class="icon">🚨</span><span>أنا في خطر!</span>';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PERSISTENT ALARM REMINDER SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

async function loadActiveReminders() {
    try {
        const data = await api.reminders.active();
        const logs = data.logs || [];

        // If new reminders appeared → trigger alarm overlay for the first one
        if (prevReminderCount >= 0 && logs.length > prevReminderCount && !activeAlarmLogId) {
            const newLog = logs[0]; // Most recent active reminder
            triggerAlarmOverlay(newLog);
        }
        prevReminderCount = logs.length;

        renderActiveReminders(logs);
    } catch (err) {
        console.error('Load reminders error:', err);
    }
}

/**
 * Show the full-screen alarm overlay and start the persistent alarm loop
 */
function triggerAlarmOverlay(log) {
    if (!log || !log.reminder) return;
    activeAlarmLogId = log.id;
    const r = log.reminder;
    const emoji = typeEmojis[r.type] || '🔔';

    document.getElementById('alarmIcon').textContent = emoji;
    document.getElementById('alarmTitle').textContent = r.title;
    document.getElementById('alarmSubtitle').textContent = r.description || '';
    document.getElementById('alarmTimeLabel').textContent = r.scheduledTime || '';

    // Set button labels based on type
    const confirmLabel = r.type === 'MEDICINE' ? '✅ تم أخذ الدواء' :
        r.type === 'MEAL' ? '✅ تم الأكل' :
            r.type === 'WATER' ? '✅ شربت ميه' :
                r.type === 'EXERCISE' ? '✅ تمرنت' :
                    '✅ تم';
    document.getElementById('alarmConfirmBtn').textContent = confirmLabel;

    // Show overlay
    document.getElementById('alarmOverlay').classList.add('active');

    // Start persistent alarm sound
    if (typeof startAlarmLoop === 'function') startAlarmLoop();
}

/**
 * Dismiss alarm — confirm the reminder
 */
async function confirmAlarmReminder() {
    if (!activeAlarmLogId) return;
    const logId = activeAlarmLogId;

    // Stop alarm immediately
    dismissAlarmOverlay();

    try {
        await api.reminders.confirm(logId);
        showToast('✅ تم التسجيل — برافو عليك! 👏', 'success', 5000);
        await loadActiveReminders();
        await loadTodaySchedule();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/**
 * Snooze alarm — delay for 5 minutes
 */
async function snoozeAlarmReminder() {
    if (!activeAlarmLogId) return;
    const logId = activeAlarmLogId;

    // Stop alarm immediately
    dismissAlarmOverlay();

    try {
        await api.reminders.snooze(logId, 5);
        showToast('⏰ هنذكرك تاني بعد ٥ دقايق!', 'info', 4000);
        await loadActiveReminders();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

/**
 * Hide the alarm overlay and stop the sound
 */
function dismissAlarmOverlay() {
    if (typeof stopAlarmLoop === 'function') stopAlarmLoop();
    document.getElementById('alarmOverlay').classList.remove('active');
    activeAlarmLogId = null;
}

// ─── Render reminder cards (below the alarm) ─────────────────────────────────
function renderActiveReminders(logs) {
    const container = document.getElementById('activeReminders');
    if (!logs.length) {
        container.innerHTML = `
      <div class="empty-reminders animate-fade-in">
        <span class="icon">✨</span>
        <p>ما فيش تذكيرات دلوقتي<br><small style="font-size:0.85rem; color: #64748B;">استمتع بوقتك!</small></p>
      </div>`;
        return;
    }

    container.innerHTML = logs.map(log => {
        const r = log.reminder;
        const emoji = typeEmojis[r.type] || '🔔';
        return `
      <div class="reminder-card type-${r.type} animate-fade-in" id="remcard-${log.id}">
        <span class="reminder-emoji">${emoji}</span>
        <div class="reminder-title-big">${r.title}</div>
        ${r.description ? `<div class="reminder-desc-big">${r.description}</div>` : ''}
        <div style="font-size:0.95rem; color: #94A3B8; margin-bottom:1.25rem;">🕐 ${r.scheduledTime}</div>
        <div class="btn-group-elder">
          <button class="btn btn-success btn-elder" onclick="confirmReminder('${log.id}')">✅ تم</button>
          <button class="btn btn-warning btn-elder" onclick="snoozeReminder('${log.id}')">⏰ بعدين</button>
        </div>
      </div>`;
    }).join('');
}

async function confirmReminder(logId) {
    const card = document.getElementById(`remcard-${logId}`);
    if (card) { card.style.opacity = '0.5'; card.style.pointerEvents = 'none'; }

    try {
        await api.reminders.confirm(logId);
        showToast('✅ تم التسجيل — برافو عليك!', 'success', 5000);
        if (card) {
            card.style.transition = 'all 0.5s ease';
            card.style.transform = 'scale(0.8)';
            card.style.opacity = '0';
            setTimeout(() => { card.remove(); checkEmptyReminders(); }, 500);
        }
        await loadTodaySchedule();
    } catch (err) {
        showToast(err.message, 'error');
        if (card) { card.style.opacity = '1'; card.style.pointerEvents = 'auto'; }
    }
}

async function snoozeReminder(logId) {
    const card = document.getElementById(`remcard-${logId}`);
    if (card) { card.style.opacity = '0.5'; card.style.pointerEvents = 'none'; }

    try {
        await api.reminders.snooze(logId, 5);
        showToast('⏰ هنذكرك تاني بعد ٥ دقايق!', 'info', 4000);
        if (card) {
            card.style.transition = 'all 0.5s ease';
            card.style.opacity = '0';
            setTimeout(() => { card.remove(); checkEmptyReminders(); }, 500);
        }
    } catch (err) {
        showToast(err.message, 'error');
        if (card) { card.style.opacity = '1'; card.style.pointerEvents = 'auto'; }
    }
}

function checkEmptyReminders() {
    const container = document.getElementById('activeReminders');
    if (container && container.querySelectorAll('.reminder-card').length === 0) {
        container.innerHTML = `
      <div class="empty-reminders animate-fade-in">
        <span class="icon">✨</span>
        <p>خلصت كل التذكيرات!<br><small style="font-size:0.85rem; color: #64748B;">كويس عليك 👏</small></p>
      </div>`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TODAY'S SCHEDULE — merged reminders + calendar events
// ═══════════════════════════════════════════════════════════════════════════════

async function loadTodaySchedule() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const month = today.substring(0, 7);

        // Fetch both reminders schedule and calendar events
        const [schedData, calData] = await Promise.all([
            api.reminders.schedule(),
            api.calendar.myEvents(month).catch(() => ({ events: [] }))
        ]);

        const reminders = schedData.reminders || [];
        const todayLogs = schedData.todayLogs || [];
        const events = (calData.events || []).filter(e => e.date === today);

        // Build unified schedule items
        const items = [];

        // Add reminders
        reminders.forEach(r => {
            const todayLog = todayLogs.find(l => l.reminderId === r.id);
            const status = !todayLog ? '⏳' : { CONFIRMED: '✅', MISSED: '❌', SNOOZED: '⏰', PENDING: '🔔' }[todayLog.status] || '⏳';
            items.push({
                time: r.scheduledTime,
                title: r.title,
                emoji: typeEmojis[r.type] || '🔔',
                status,
                sortKey: r.scheduledTime
            });
        });

        // Add calendar events
        events.forEach(e => {
            items.push({
                time: e.time || '—',
                title: e.title,
                emoji: eventTypeEmojis[e.type] || '📌',
                status: '📅',
                sortKey: e.time || '99:99'
            });
        });

        // Sort by time
        items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

        const container = document.getElementById('todaySchedule');
        if (!items.length) {
            container.innerHTML = `<div class="empty-reminders"><span class="icon">📅</span><p style="color:#94A3B8;">جدولك فاضي النهارده</p></div>`;
            return;
        }

        container.innerHTML = items.map(item => `
        <div class="schedule-item">
          <div class="schedule-time">${item.time}</div>
          <span style="font-size:1.3rem;">${item.emoji}</span>
          <div class="schedule-label">${item.title}</div>
          <div class="schedule-status">${item.status}</div>
        </div>
      `).join('');
    } catch (err) {
        console.error('Schedule error:', err);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadAlerts() {
    try {
        const data = await api.alerts.myAlerts();
        const alerts = data.alerts || [];

        if (prevAlertCount >= 0 && alerts.filter(a => !a.isRead).length > prevAlertCount) {
            if (typeof playAlertSound === 'function') playAlertSound();
        }
        prevAlertCount = alerts.filter(a => !a.isRead).length;

        // Critical alerts at top
        const critical = alerts.filter(a => a.severity === 'CRITICAL' && !a.isRead);
        const criticalEl = document.getElementById('criticalAlerts');
        if (critical.length) {
            criticalEl.innerHTML = critical.map(a => `
        <div class="alert-elder animate-fade-in">
          <div class="alert-icon">🚨</div>
          <div style="flex:1;">
            <div class="alert-elder-text">${a.message}</div>
            <div style="font-size:0.85rem; color:#FCA5A5; margin-top:0.25rem;">${timeAgo(a.createdAt)}</div>
          </div>
          <button style="background:none;border:none;color:#FCA5A5;cursor:pointer;font-size:1.25rem;" onclick="this.parentElement.remove()">✕</button>
        </div>`).join('');
        } else {
            criticalEl.innerHTML = '';
        }

        // Non-critical alerts
        const nonCritical = alerts.filter(a => a.severity !== 'CRITICAL').slice(0, 5);
        const alertsSection = document.getElementById('alertsSection');
        const alertsList = document.getElementById('elderAlertsList');

        if (nonCritical.length) {
            alertsSection.style.display = 'block';
            alertsList.innerHTML = nonCritical.map(a => {
                const icons = { FALL: '🚨', FIRE: '🔥', MOOD: '😔', HEALTH: '💓', EMERGENCY: '🚨', default: '⚠️' };
                return `
          <div class="schedule-item" style="${!a.isRead ? 'border-right: 3px solid var(--warning);' : ''}">
            <span style="font-size:1.5rem;">${icons[a.type] || icons.default}</span>
            <div style="flex:1;">
              <div style="font-weight:600; font-size:1rem; color:#F1F5F9;">${a.message}</div>
              <div style="font-size:0.8rem; color:#94A3B8;">${timeAgo(a.createdAt)}</div>
            </div>
          </div>`;
            }).join('');
        } else {
            alertsSection.style.display = 'none';
        }
    } catch (err) {
        console.error('Elder alerts error:', err);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DIRECT MESSAGING — Chat Overlay
// ═══════════════════════════════════════════════════════════════════════════════

function openChatOverlay() {
    if (!monitorInfo) {
        showToast('مافيش مسؤول مرتبط بيك لسه', 'warning');
        return;
    }
    chatOverlayOpen = true;
    document.getElementById('chatOverlay').classList.add('active');
    document.getElementById('chatBackdrop').classList.add('active');
    loadDirectMessages();
}

function closeChatOverlay() {
    chatOverlayOpen = false;
    document.getElementById('chatOverlay').classList.remove('active');
    document.getElementById('chatBackdrop').classList.remove('active');
}

async function loadDirectMessages() {
    if (!monitorInfo) return;

    try {
        const data = await api.messages.conversation(monitorInfo.id, 40);
        const messages = data.messages || [];
        const container = document.getElementById('dmMessages');
        const user = getUser();

        if (!messages.length) {
            container.innerHTML = '<div style="text-align:center; color:#64748B; padding:2rem; font-size:1rem;">ابدأ محادثة مع المسؤول...</div>';
            return;
        }

        container.innerHTML = messages.map(m => {
            const isSent = m.senderId === user.id;
            return `
        <div class="dm-msg ${isSent ? 'sent' : 'received'}">
          ${m.content}
          <div class="dm-time">${formatTime(m.createdAt)}</div>
        </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;

        // Mark messages as read
        await api.messages.markRead(monitorInfo.id);
    } catch (err) {
        console.error('DM load error:', err);
    }
}

async function sendDM() {
    if (!monitorInfo) return;
    const input = document.getElementById('dmInput');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';

    try {
        await api.messages.send(monitorInfo.id, content);
        if (typeof playMessageSound === 'function') playMessageSound();
        await loadDirectMessages();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function checkUnreadMessages() {
    try {
        const data = await api.messages.unreadCount();
        const badge = document.getElementById('fabChatBadge');
        if (badge) {
            if (data.unreadCount > 0) {
                badge.style.display = 'block';
                badge.textContent = data.unreadCount;
                if (prevMsgCount >= 0 && data.unreadCount > prevMsgCount) {
                    if (typeof playMessageSound === 'function') playMessageSound();
                }
            } else {
                badge.style.display = 'none';
            }
            prevMsgCount = data.unreadCount;
        }
    } catch (err) { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOCATION TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

function startLocationTracking() {
    if (!navigator.geolocation) return;
    sendLocation();
    setInterval(sendLocation, 90000);
}

async function sendLocation() {
    try {
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                timeout: 10000, enableHighAccuracy: false, maximumAge: 60000
            });
        });
        await api.location.update(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    } catch (err) {
        console.log('Location update skipped:', err.message);
    }
}

// ─── Logout ───────────────────────────────────────────────────────────────────
function logout() {
    clearInterval(pollInterval);
    if (typeof stopAlarmLoop === 'function') stopAlarmLoop();
    clearAuth();
    window.location.href = '/index.html';
}
