/**
 * SANAD - سند | Monitor Dashboard Logic
 * Handles all monitor dashboard interactions:
 * - Loading connected elders
 * - Tab navigation
 * - Reminder CRUD
 * - Alert polling + emergency banners
 * - Direct messaging (Elder ↔ Monitor)
 * - Monthly calendar with event CRUD
 * - Elder location map (Leaflet)
 * - Reports with Chart.js
 */

let elders = [];
let selectedElderId = null;
let pollInterval = null;
let currentTab = 'overview';
let calendarYear, calendarMonth;
let calendarEvents = [];
let leafletMap = null;
let leafletMarker = null;

// Audio trigger tracking
let prevAlertCount = -1;
let prevMsgCount = -1;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const user = requireAuth('MONITOR');
    if (!user) return;

    document.getElementById('sidebarUserName').textContent = user.name;

    // Init calendar to current month
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();

    await loadElders();

    // Poll every 15s for alerts and messages
    pollInterval = setInterval(async () => {
        await loadAlerts();
        await checkUnreadMessages();
    }, 15000);
});

// ─── Sidebar & Tabs ───────────────────────────────────────────────────────────
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    event.currentTarget.classList.add('active');

    // Load tab data
    if (selectedElderId) {
        if (tab === 'reminders') loadReminders(selectedElderId);
        if (tab === 'alerts') loadAlerts();
        if (tab === 'chat') loadDMChat(selectedElderId);
        if (tab === 'calendar') loadCalendar(selectedElderId);
        if (tab === 'location') loadElderLocation(selectedElderId);
        if (tab === 'management') loadManagementTab(selectedElderId);
        if (tab === 'reports') loadReports(selectedElderId);
    }
    if (tab === 'settings') loadSettingsTab();

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('open');
}

// ─── Load Elders ──────────────────────────────────────────────────────────────
async function loadElders() {
    try {
        const data = await api.connections.myElders();
        elders = (data.connections || []).filter(c => c.elder);

        document.getElementById('statElders').textContent = elders.length;

        const selector = document.getElementById('elderSelector');
        if (!elders.length) {
            selector.innerHTML = '<div style="color:#94A3B8; padding:1rem; text-align:center;">لا يوجد كبار سن مرتبطين — <a href="/link-elder.html" style="color:var(--primary);">اربط كبير سن</a></div>';
            return;
        }

        selector.innerHTML = elders.map(c => `
            <div class="elder-chip ${c.elder.id === selectedElderId ? 'active' : ''}" onclick="selectElder('${c.elder.id}')">
                👴 ${c.elder.name}
            </div>
        `).join('');

        // Auto-select first elder if none selected
        if (!selectedElderId && elders.length > 0) {
            selectElder(elders[0].elder.id);
        }
    } catch (err) {
        console.error('Load elders error:', err);
    }
}

async function selectElder(elderId) {
    selectedElderId = elderId;

    // Update selector UI
    document.querySelectorAll('.elder-chip').forEach(c => c.classList.remove('active'));
    event?.currentTarget?.classList.add('active');

    // Load data for selected elder
    await Promise.all([
        loadReminders(elderId),
        loadAlerts(),
        loadElderInfo(elderId),
        loadCalendar(elderId),
        loadDMChat(elderId),
        checkUnreadMessages()
    ]);

    // Also update management tab if it's active
    if (currentTab === 'management') loadManagementTab(elderId);
}

async function loadElderInfo(elderId) {
    const elder = elders.find(c => c.elder.id === elderId)?.elder;
    if (!elder) return;

    document.getElementById('overviewElderInfo').style.display = 'block';
    document.getElementById('elderInfoContent').innerHTML = `
        <div style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
            <div style="width:56px; height:56px; border-radius:50%; background:linear-gradient(135deg, var(--primary), var(--secondary)); display:flex; align-items:center; justify-content:center; font-size:2rem; color:white;">👴</div>
            <div>
                <div style="font-size:1.1rem; font-weight:700; color:#1E293B;">${elder.name}</div>
                <div style="font-size:0.85rem; color:#64748B;">${elder.email}</div>
                ${elder.phone ? `<div style="font-size:0.85rem; color:#64748B;">📞 ${elder.phone}</div>` : ''}
            </div>
        </div>
    `;
}

// ─── Reminders ────────────────────────────────────────────────────────────────
async function loadReminders(elderId) {
    try {
        const data = await api.reminders.list(elderId);
        const reminders = data.reminders || [];

        document.getElementById('statReminders').textContent = reminders.filter(r => r.isActive).length;

        const container = document.getElementById('remindersList');
        if (!reminders.length) {
            container.innerHTML = '<p style="color:#94A3B8; text-align:center;">لا توجد تذكيرات بعد</p>';
            return;
        }

        const typeMap = { MEDICINE: { icon: '💊', color: '#EF4444' }, MEAL: { icon: '🍽️', color: '#F5A623' }, WATER: { icon: '💧', color: '#0EA5E9' }, EXERCISE: { icon: '🏃', color: '#22C55E' }, APPOINTMENT: { icon: '📅', color: '#1B5FAD' }, CUSTOM: { icon: '🔔', color: '#2BBFB3' } };

        container.innerHTML = reminders.map(r => {
            const t = typeMap[r.type] || typeMap.CUSTOM;
            const repeatLabels = { DAILY: 'يومي', WEEKLY: 'أسبوعي', MONTHLY: 'شهري', ONCE: 'مرة واحدة' };
            return `
            <div class="reminder-item" style="opacity: ${r.isActive ? 1 : 0.5}">
                <div class="reminder-type-dot" style="background:${t.color}"></div>
                <span style="font-size:1.2rem;">${t.icon}</span>
                <div class="reminder-info">
                    <div class="reminder-title">${r.title}</div>
                    <div class="reminder-meta">${r.scheduledTime} • ${repeatLabels[r.repeatRule] || r.repeatRule} ${!r.isActive ? '• (موقف)' : ''}</div>
                </div>
                <div class="reminder-actions">
                    <button title="تعديل" onclick="editReminder('${r.id}')">✏️</button>
                    <button title="${r.isActive ? 'إيقاف' : 'تفعيل'}" onclick="toggleReminder('${r.id}', ${!r.isActive})">${r.isActive ? '⏸️' : '▶️'}</button>
                    <button title="حذف" onclick="deleteReminder('${r.id}')">🗑️</button>
                </div>
            </div>
        `;
        }).join('');
    } catch (err) {
        console.error('Reminders error:', err);
    }
}

function showReminderModal() {
    if (!selectedElderId) { showToast('اختر كبير سن أولاً', 'warning'); return; }
    document.getElementById('reminderModal').classList.add('active');
}

async function createReminder() {
    const title = document.getElementById('remTitle').value.trim();
    const scheduledTime = document.getElementById('remTime').value;
    if (!title || !scheduledTime) { showToast('العنوان والوقت مطلوبين', 'warning'); return; }

    try {
        await api.reminders.create({
            elderId: selectedElderId,
            title,
            description: document.getElementById('remDesc').value.trim() || null,
            type: document.getElementById('remType').value,
            scheduledTime,
            repeatRule: document.getElementById('remRepeat').value
        });

        showToast('تم إنشاء التذكير ✅', 'success');
        closeModal('reminderModal');
        // Clear form
        document.getElementById('remTitle').value = '';
        document.getElementById('remDesc').value = '';
        document.getElementById('remTime').value = '';
        await loadReminders(selectedElderId);
        if (currentTab === 'management') loadManagementTab(selectedElderId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function toggleReminder(id, isActive) {
    try {
        await api.reminders.update(id, { isActive });
        showToast(isActive ? 'تم تفعيل التذكير' : 'تم إيقاف التذكير', 'info');
        await loadReminders(selectedElderId);
        if (currentTab === 'management') loadManagementTab(selectedElderId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteReminder(id) {
    if (!confirm('متأكد من حذف التذكير؟')) return;
    try {
        await api.reminders.delete(id);
        showToast('تم حذف التذكير', 'success');
        await loadReminders(selectedElderId);
        if (currentTab === 'management') loadManagementTab(selectedElderId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function editReminder(id) {
    // Simple edit: delete and recreate via modal
    showReminderModal();
}

// ─── Alerts ───────────────────────────────────────────────────────────────────
async function loadAlerts() {
    try {
        const data = await api.alerts.list();
        const alerts = data.alerts || [];
        const unread = data.unreadCount || 0;

        // Badge
        const badge = document.getElementById('alertBadge');
        if (unread > 0) { badge.style.display = 'inline'; badge.textContent = unread; }
        else { badge.style.display = 'none'; }

        document.getElementById('statAlerts').textContent = unread;

        // Audio on new alerts
        if (prevAlertCount >= 0 && unread > prevAlertCount) {
            if (typeof playAlertSound === 'function') playAlertSound();

            // 🔥 REAL-TIME SYNC: If new alert is MOOD, reload reports/management
            const latestAlert = alerts[0];
            if (latestAlert && latestAlert.type === 'MOOD' && latestAlert.elderId === selectedElderId) {
                console.log('🔄 [SYNC] New Mood detected! Refreshing reports...');
                if (currentTab === 'reports') loadReports(selectedElderId);
                if (currentTab === 'management') loadManagementTab(selectedElderId);
            }
        }
        prevAlertCount = unread;

        // Emergency banners and Danger Mode
        const emergencies = alerts.filter(a => (a.type === 'EMERGENCY' || a.severity === 'CRITICAL') && !a.isRead);

        const siren = document.getElementById('sirenSound');
        const popupText = document.getElementById('dangerPopupText');
        const popupSub = document.getElementById('dangerPopupSub');

        if (emergencies.length > 0) {
            document.body.classList.add('danger-mode');

            // Update popup text with the first emergency
            if (popupText && popupSub) {
                const latestE = emergencies[0];
                const elderName = latestE.elder?.name || 'كبير السن';
                popupText.textContent = `تحذير طارئ لـ ${elderName}!`;
                popupSub.textContent = latestE.message;
            }

            if (siren && siren.paused) {
                siren.play().catch(e => console.log("Audio play prevented by browser:", e));
            }
        } else {
            document.body.classList.remove('danger-mode');
            if (siren) {
                siren.pause();
                siren.currentTime = 0;
            }
        }

        const bannerContainer = document.getElementById('emergencyBanners');
        if (emergencies.length) {
            bannerContainer.innerHTML = emergencies.map(a => {
                let locationLink = '';
                if (a.metadata) {
                    try {
                        const meta = JSON.parse(a.metadata);
                        if (meta.latitude && meta.longitude) {
                            locationLink = `<a href="https://www.google.com/maps?q=${meta.latitude},${meta.longitude}" target="_blank" style="color:var(--primary); font-size:0.85rem;">📍 عرض الموقع</a>`;
                        }
                    } catch (e) { }
                }
                let videoBtnBanner = '';
                if (a.metadata) {
                    try {
                        const m = JSON.parse(a.metadata);
                        if (m.video_url) {
                            let port = a.type === 'FALL' ? '8012' : (a.type === 'MOOD' ? '8014' : '8013');
                            const fullUrl = `http://localhost:${port}${m.video_url}`;
                            videoBtnBanner = `<button class="btn btn-sm" style="background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.4); color:white; font-family:var(--font); cursor:pointer; padding:0.4rem 0.8rem; border-radius:var(--radius-md); font-size:0.8rem; display:flex; align-items:center; gap:5px;" onclick="viewVideoEvidence('${fullUrl}', ${JSON.stringify(m).replace(/"/g, '&quot;')})">🎥 مشاهدة الفيديو</button>`;
                        }
                    } catch (e) { }
                }

                return `
                <div class="emergency-banner" style="display:flex; justify-content:space-between; align-items:center; gap:1.5rem;">
                    <div style="display:flex; align-items:center; gap:1rem;">
                        <div class="icon" style="font-size:1.8rem; animation: pulse 1s infinite;">🚨</div>
                        <div class="info">
                            <h4 style="margin:0; font-size:1rem; font-weight:800;">${a.message}</h4>
                            <p style="margin:2px 0 0; font-size:0.85rem; opacity:0.9;">${a.elder?.name || 'كبير السن'} • ${timeAgo(a.createdAt)} ${locationLink}</p>
                        </div>
                    </div>
                    <div style="display:flex; gap:0.5rem;">
                        ${videoBtnBanner}
                        <button class="btn btn-sm" style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#EF4444; font-family:var(--font); cursor:pointer; padding:0.4rem 0.8rem; border-radius:var(--radius-md); font-size:0.8rem; white-space:nowrap;" onclick="markAlertRead('${a.id}')">✓ قرأت</button>
                    </div>
                </div>
            `;
            }).join('');
        } else {
            bannerContainer.innerHTML = '';
        }

        // Recent alerts for overview
        const recentContainer = document.getElementById('recentAlerts');
        const recent = alerts.slice(0, 5);
        if (recent.length) {
            recentContainer.innerHTML = recent.map(a => {
                const severityClass = a.severity === 'CRITICAL' ? 'critical' : a.severity === 'HIGH' ? 'high' : a.severity === 'MEDIUM' ? 'medium' : 'low';
                const icons = { FALL: '🚨', FIRE: '🔥', MOOD: '😔', HEALTH: '💓', EMERGENCY: '🚨', MANUAL: '📌', default: '⚠️' };
                let videoBtn = '';
                let healthInfo = '';
                if (a.metadata) {
                    try {
                        const m = JSON.parse(a.metadata);
                        if (m.video_url) {
                            // Unified Ports based on new microservices architecture
                            let port = '8013'; // Default Fire/Smoke
                            if (a.type === 'FALL') port = '8012';
                            if (a.type === 'MOOD') port = '8014';

                            const fullUrl = `http://localhost:${port}${m.video_url}`;
                            videoBtn = `<button onclick="viewVideoEvidence('${fullUrl}', ${JSON.stringify(m).replace(/"/g, '&quot;')})" style="background:rgba(239, 68, 68, 0.1); color:#EF4444; border:1px solid rgba(239, 68, 68, 0.2); border-radius:6px; padding:0.25rem 0.5rem; font-size:0.75rem; cursor:pointer; margin-top:8px; font-weight:bold; display:flex; align-items:center; gap:5px;">🎥 مشاهدة دليل الفيديو (AI)</button>`;
                        }
                        if (a.type === 'HEALTH' && m.prediction) {
                            healthInfo = `<div style="font-size:0.75rem; color:var(--primary); margin-top:2px; font-weight:500;">📊 ${m.prediction === 'high' ? 'خطورة مرتفعة ⚠️' : 'خطورة منخفضة ✅'}</div>`;
                        }

                    } catch (e) { }
                }
                return `
                <div class="alert-item ${severityClass}">
                    <span style="font-size:1.4rem;">${icons[a.type] || icons.default}</span>
                    <div style="flex:1;">
                        <div style="font-weight:600; font-size:0.9rem; color:#1E293B;">${a.message}</div>
                        <div style="font-size:0.8rem; color:#64748B; margin-top:2px;">${a.elder?.name || ''} • ${timeAgo(a.createdAt)} • ${a.severity}</div>
                        ${healthInfo}
                        ${videoBtn}
                    </div>
                    ${!a.isRead ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--danger);flex-shrink:0;"></span>' : ''}
                </div>
            `;
            }).join('');
        } else {
            recentContainer.innerHTML = '<p style="color:#94A3B8; text-align:center;">لا توجد تنبيهات</p>';
        }

        // Full alerts list for alerts tab
        const alertsList = document.getElementById('alertsList');
        if (alerts.length) {
            alertsList.innerHTML = alerts.map(a => {
                const severityClass = a.severity === 'CRITICAL' ? 'critical' : a.severity === 'HIGH' ? 'high' : a.severity === 'MEDIUM' ? 'medium' : 'low';
                const icons = { FALL: '🚨', FIRE: '🔥', MOOD: '😔', HEALTH: '💓', EMERGENCY: '🚨', MANUAL: '📌', default: '⚠️' };
                let locationLink = '';
                if (a.metadata) {
                    try {
                        const meta = JSON.parse(a.metadata);
                        if (meta.latitude && meta.longitude) {
                            locationLink = ` • <a href="https://www.google.com/maps?q=${meta.latitude},${meta.longitude}" target="_blank" style="color:var(--primary);">📍 الموقع</a>`;
                        }
                    } catch (e) { }
                }
                let videoBtn = '';
                let healthInfo = '';
                if (a.metadata) {
                    try {
                        const m = JSON.parse(a.metadata);
                        if (m.video_url) {
                            let port = '8013'; // Default Fire
                            if (a.type === 'FALL') port = '8012';
                            if (a.type === 'MOOD') port = '8014';

                            const fullUrl = `http://localhost:${port}${m.video_url}`;
                            videoBtn = `<button onclick="viewVideoEvidence('${fullUrl}', ${JSON.stringify(m).replace(/"/g, '&quot;')})" style="background:rgba(239, 68, 68, 0.1); color:#EF4444; border:1px solid rgba(239, 68, 68, 0.2); border-radius:6px; padding:0.3rem 0.7rem; font-size:0.75rem; cursor:pointer; margin-top:8px; font-weight:bold;">🎥 مشاهدة دليل الفيديو (AI Evidence)</button>`;
                        }
                        if (a.type === 'HEALTH' && m.prediction) {
                            healthInfo = `<div style="font-size:0.75rem; color:var(--primary); margin-top:2px; font-weight:500;">📊 ${m.prediction === 'high' ? 'خطورة مرتفعة ⚠️' : 'خطورة منخفضة ✅'}</div>`;
                        }
                    } catch (e) { }
                }

                return `
                <div class="alert-item ${severityClass}">
                    <span style="font-size:1.4rem;">${icons[a.type] || icons.default}</span>
                    <div style="flex:1;">
                        <div style="font-weight:600; font-size:0.9rem; color:#1E293B;">${a.message}</div>
                        <div style="font-size:0.8rem; color:#64748B; margin-top:2px;">${a.elder?.name || ''} • ${timeAgo(a.createdAt)} • ${a.severity}${locationLink}</div>
                        ${healthInfo}
                        ${videoBtn}
                    </div>
                    ${!a.isRead ? `<button style="background:none;border:1px solid #E2E8F0;border-radius:var(--radius-sm);padding:0.3rem 0.6rem;cursor:pointer;font-family:var(--font);font-size:0.75rem;color:#64748B;" onclick="markAlertRead('${a.id}')">✓</button>` : ''}
                </div>
            `;
            }).join('');
        }
    } catch (err) {
        console.error('Alerts error:', err);
    }
}

async function markAlertRead(id) {
    try {
        await api.alerts.markRead(id);
        await loadAlerts();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function stopEmergencyMode() {
    document.body.classList.remove('danger-mode');
    const siren = document.getElementById('sirenSound');
    if (siren) {
        siren.pause();
        siren.currentTime = 0;
    }
}

async function markAllAlertsRead() {
    try {
        await api.alerts.readAll();
        showToast('تم قراءة كل التنبيهات', 'success');
        await loadAlerts();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ─── Direct Messaging ─────────────────────────────────────────────────────────
async function loadDMChat(elderId) {
    const container = document.getElementById('chatPanelContent');
    if (!elderId) {
        container.innerHTML = '<p style="color:#94A3B8; text-align:center;">اختر كبير سن لبدء المحادثة</p>';
        return;
    }

    const elder = elders.find(c => c.elder.id === elderId)?.elder;

    try {
        const data = await api.messages.conversation(elderId, 50);
        const messages = data.messages || [];
        const user = getUser();

        container.innerHTML = `
            <div class="dm-panel">
                <div class="dm-messages" id="dmMessagesBox">
                    ${messages.length ? messages.map(m => {
            const isSent = m.senderId === user.id;
            return `<div class="dm-msg ${isSent ? 'sent' : 'received'}">${escapeHtml(m.content)}<div class="dm-time">${formatTime(m.createdAt)}</div></div>`;
        }).join('') : '<div style="text-align:center; color:#94A3B8; padding:2rem; font-size:0.9rem;">ابدأ محادثة مع ${elder?.name || "كبير السن"}...</div>'}
                </div>
                <div class="dm-input-row">
                    <input type="text" id="dmInput" placeholder="اكتب رسالة..." onkeydown="if(event.key==='Enter') sendDMToElder()" />
                    <button class="dm-send-btn" onclick="sendDMToElder()">➤</button>
                </div>
            </div>
        `;

        // Mark messages as read
        await api.messages.markRead(elderId);

        // Scroll to bottom
        const box = document.getElementById('dmMessagesBox');
        if (box) box.scrollTop = box.scrollHeight;
    } catch (err) {
        container.innerHTML = '<p style="color:#94A3B8; text-align:center;">خطأ في تحميل الرسائل</p>';
        console.error('DM error:', err);
    }
}

async function sendDMToElder() {
    if (!selectedElderId) return;
    const input = document.getElementById('dmInput');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';

    try {
        await api.messages.send(selectedElderId, content);
        if (typeof playMessageSound === 'function') playMessageSound();
        await loadDMChat(selectedElderId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function checkUnreadMessages() {
    try {
        const data = await api.messages.unreadCount();
        const count = data.unreadCount || 0;
        const badge = document.getElementById('chatBadge');

        if (count > 0) { badge.style.display = 'inline'; badge.textContent = count; }
        else { badge.style.display = 'none'; }

        document.getElementById('statMessages').textContent = count;

        // Audio on new messages
        if (prevMsgCount >= 0 && count > prevMsgCount) {
            if (typeof playMessageSound === 'function') playMessageSound();
        }
        prevMsgCount = count;
    } catch (err) { /* ignore */ }
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
async function loadCalendar(elderId) {
    if (!elderId) return;
    const monthStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}`;

    try {
        const data = await api.calendar.list(elderId, monthStr);
        calendarEvents = data.events || [];
    } catch (err) {
        calendarEvents = [];
        console.error('Calendar error:', err);
    }

    renderCalendar();
}

function renderCalendar() {
    const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    document.getElementById('calendarMonthLabel').textContent = `${monthNames[calendarMonth]} ${calendarYear}`;

    const dayNames = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
    const grid = document.getElementById('calendarGrid');

    const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    let html = dayNames.map(d => `<div class="calendar-day-header">${d}</div>`).join('');

    // Previous month padding
    const prevMonthDays = new Date(calendarYear, calendarMonth, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
        html += `<div class="calendar-day other-month"><div class="calendar-day-num">${prevMonthDays - i}</div></div>`;
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isToday = dateStr === todayStr;
        const dayEvents = calendarEvents.filter(e => e.date === dateStr);
        const dots = dayEvents.map(e => {
            const dotClass = e.type === 'DOCTOR' ? 'doctor' : e.type === 'VISIT' ? 'visit' : e.type === 'BANK' ? 'bank' : '';
            return `<span class="calendar-event-dot ${dotClass}"></span>`;
        }).join('');

        html += `
            <div class="calendar-day ${isToday ? 'today' : ''}" onclick="showDayEvents('${dateStr}')" ondblclick="showEventModal('${dateStr}')" title="اضغط مرتين لإضافة حدث">
                <div class="calendar-day-num">${d}</div>
                <div>${dots}</div>
            </div>
        `;
    }

    // Next month padding
    const totalCells = firstDay + daysInMonth;
    const remaining = 7 - (totalCells % 7);
    if (remaining < 7) {
        for (let i = 1; i <= remaining; i++) {
            html += `<div class="calendar-day other-month"><div class="calendar-day-num">${i}</div></div>`;
        }
    }

    grid.innerHTML = html;

    // Show events list for today by default
    showDayEvents(todayStr);
}

function showDayEvents(dateStr) {
    const eventTypeEmojis = { DOCTOR: '🏥', BANK: '🏦', VISIT: '👥', CUSTOM: '📌' };
    const dayEvents = calendarEvents.filter(e => e.date === dateStr);
    const container = document.getElementById('calendarEventsList');

    let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
        <div style="font-size:0.85rem; font-weight:600; color:#64748B;">أحداث ${dateStr}:</div>
        <button class="btn btn-primary btn-sm" onclick="showEventModal('${dateStr}')" style="font-size:0.75rem; padding:0.3rem 0.6rem;">+ إضافة</button>
    </div>`;

    if (!dayEvents.length) {
        html += `<p style="color:#94A3B8; text-align:center; font-size:0.85rem;">لا يوجد أحداث — اضغط + لإضافة</p>`;
    } else {
        html += dayEvents.map(e => `
        <div class="calendar-event-item">
            <span class="calendar-event-icon">${eventTypeEmojis[e.type] || '📌'}</span>
            <div class="calendar-event-info">
                <div class="calendar-event-title">${e.title}</div>
                <div class="calendar-event-meta">${e.time || ''} ${e.description || ''}</div>
            </div>
            <button style="background:none;border:none;cursor:pointer;font-size:1rem;" onclick="editEventInModal('${e.id}')" title="تعديل">✏️</button>
            <button style="background:none;border:none;cursor:pointer;font-size:1rem;" onclick="deleteEvent('${e.id}')" title="حذف">🗑️</button>
        </div>
    `).join('');
    }

    container.innerHTML = html;
}

function changeCalendarMonth(delta) {
    calendarMonth += delta;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    if (selectedElderId) loadCalendar(selectedElderId);
}

function showEventModal(presetDate) {
    if (!selectedElderId) { showToast('اختر كبير سن أولاً', 'warning'); return; }
    document.getElementById('evtTitle').value = '';
    document.getElementById('evtDesc').value = '';
    document.getElementById('evtTime').value = '';
    const dateStr = typeof presetDate === 'string' ? presetDate : new Date().toISOString().split('T')[0];
    document.getElementById('evtDate').value = dateStr;
    window._editingEventId = null; // Clear any pending edit state
    document.getElementById('eventModal').classList.add('active');
}

function editEventInModal(eventId) {
    const evt = calendarEvents.find(e => e.id === eventId);
    if (!evt) return;
    document.getElementById('evtTitle').value = evt.title;
    document.getElementById('evtDesc').value = evt.description || '';
    document.getElementById('evtDate').value = evt.date;
    document.getElementById('evtTime').value = evt.time || '';
    document.getElementById('evtType').value = evt.type || 'CUSTOM';
    document.getElementById('evtRepeat').value = evt.repeatRule || 'ONCE';
    // Delete old and create new (simple edit)
    document.getElementById('eventModal').classList.add('active');
    // Override create to delete old first
    window._editingEventId = eventId;
}

async function saveCalendarEvent() {
    const title = document.getElementById('evtTitle').value.trim();
    const date = document.getElementById('evtDate').value;
    if (!title || !date) { showToast('العنوان والتاريخ مطلوبين', 'warning'); return; }

    try {
        // If editing, delete old event first
        if (window._editingEventId) {
            try { await api.calendar.delete(window._editingEventId); } catch (e) { /* ok */ }
            window._editingEventId = null;
        }

        await api.calendar.create({
            elderId: selectedElderId,
            title,
            description: document.getElementById('evtDesc').value.trim() || null,
            type: document.getElementById('evtType').value,
            date,
            time: document.getElementById('evtTime').value || null,
            repeatRule: document.getElementById('evtRepeat').value
        });

        showToast('تم حفظ الحدث ✅', 'success');
        closeModal('eventModal');
        document.getElementById('evtTitle').value = '';
        document.getElementById('evtDesc').value = '';
        document.getElementById('evtTime').value = '';
        await loadCalendar(selectedElderId);
        showDayEvents(date); // Keep the view on the day we just edited
        if (currentTab === 'management') loadManagementTab(selectedElderId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteEvent(id) {
    if (!confirm('متأكد من حذف الحدث؟')) return;
    try {
        await api.calendar.delete(id);
        showToast('تم حذف الحدث', 'success');
        await loadCalendar(selectedElderId);
        if (currentTab === 'management') loadManagementTab(selectedElderId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ─── Location Map ─────────────────────────────────────────────────────────────
async function loadElderLocation(elderId) {
    const container = document.getElementById('locationContent');
    if (!elderId) {
        container.innerHTML = '<p style="color:#94A3B8; text-align:center;">اختر كبير سن لعرض موقعه</p>';
        return;
    }

    try {
        const data = await api.location.get(elderId);

        if (!data.location) {
            container.innerHTML = '<p style="color:#94A3B8; text-align:center;">لا يوجد موقع مُسجل لكبير السن بعد — الموقع يتحدث تلقائياً عند فتح الداشبورد</p>';
            return;
        }

        const loc = data.location;
        const elder = elders.find(c => c.elder.id === elderId)?.elder;

        container.innerHTML = `
            <div class="map-container" id="mapContainer">
                <div id="elderMap"></div>
            </div>
            <div class="map-info">
                <div class="map-info-item"><strong>خط العرض:</strong> ${loc.latitude.toFixed(6)}</div>
                <div class="map-info-item"><strong>خط الطول:</strong> ${loc.longitude.toFixed(6)}</div>
                ${loc.accuracy ? `<div class="map-info-item"><strong>الدقة:</strong> ${Math.round(loc.accuracy)}م</div>` : ''}
                <div class="map-info-item"><strong>آخر تحديث:</strong> ${timeAgo(loc.createdAt)}</div>
            </div>
        `;

        // Init Leaflet map
        setTimeout(() => {
            if (leafletMap) { leafletMap.remove(); }

            leafletMap = L.map('elderMap').setView([loc.latitude, loc.longitude], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap'
            }).addTo(leafletMap);

            leafletMarker = L.marker([loc.latitude, loc.longitude]).addTo(leafletMap)
                .bindPopup(`<b>${elder?.name || 'كبير السن'}</b><br>آخر تحديث: ${timeAgo(loc.createdAt)}`)
                .openPopup();

            // Accuracy circle
            if (loc.accuracy) {
                L.circle([loc.latitude, loc.longitude], {
                    radius: loc.accuracy,
                    color: '#1B5FAD',
                    fillColor: '#1B5FAD',
                    fillOpacity: 0.1,
                    weight: 1
                }).addTo(leafletMap);
            }
        }, 100);
    } catch (err) {
        container.innerHTML = '<p style="color:#EF4444; text-align:center;">خطأ في تحميل الموقع</p>';
        console.error('Location error:', err);
    }
}

// ─── Reports ──────────────────────────────────────────────────────────────────
async function loadReports(elderId) {
    if (!elderId) return;

    try {
        // ─── AI Health Assessment ───
        const aiHealthCard = document.getElementById('aiHealthReportCard');
        const aiHealthContent = document.getElementById('aiHealthReportContent');

        try {
            const alertsRes = await api.alerts.list({ elderId, type: 'HEALTH' });
            const latestAssessment = (alertsRes.alerts || [])
                .find(a => a.source === 'HEALTH_PREDICTION');

            if (latestAssessment) {
                const meta = JSON.parse(latestAssessment.metadata || '{}');
                const isHigh = meta.prediction === 'high';
                const elderName = elders.find(c => c.elder.id === elderId)?.elder.name.split(' ')[0] || 'الحاج';

                const message = isHigh
                    ? `الحاج **${elderName}** يحتاج زيارة للطبيب فوراً! ⚠️`
                    : `الحاج **${elderName}** بخير الآن.. ✅`;

                const bgColor = isHigh ? 'rgba(239, 68, 68, 0.05)' : 'rgba(34, 197, 94, 0.05)';
                const textColor = isHigh ? '#DC2626' : '#16A34A';

                aiHealthCard.style.display = 'block';
                aiHealthContent.innerHTML = `
                    <div style="background: ${bgColor}; padding: 1.25rem; border-radius: 12px; border: 1px solid ${isHigh ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}; margin-bottom: 1.5rem; text-align: center;">
                        <div style="font-size: 1.25rem; font-weight: 800; color: ${textColor}; margin-bottom: 0.25rem;">${message}</div>
                        <div style="font-size: 0.85rem; color: #64748B;">تاريخ التقييم: ${formatDateTime(latestAssessment.createdAt)}</div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: white; padding: 0.75rem; border-radius: 8px; border: 1px solid #E2E8F0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                            <div style="font-size: 0.75rem; color: #94A3B8; margin-bottom: 0.2rem;">الوزن / الطول</div>
                            <div style="font-weight: 700; color: #1E293B;">${meta.weight || '--'} كجم / ${meta.height || '--'} سم</div>
                        </div>
                        <div style="background: white; padding: 0.75rem; border-radius: 8px; border: 1px solid #E2E8F0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                            <div style="font-size: 0.75rem; color: #94A3B8; margin-bottom: 0.2rem;">ساعات النوم</div>
                            <div style="font-weight: 700; color: #1E293B;">${meta.sleep || '--'} ساعة</div>
                        </div>
                        <div style="background: white; padding: 0.75rem; border-radius: 8px; border: 1px solid #E2E8F0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                            <div style="font-size: 0.75rem; color: #94A3B8; margin-bottom: 0.2rem;">النشاط البدني</div>
                            <div style="font-weight: 700; color: #1E293B;">${meta.exercise === 'regular' ? '🏃 بانتظام' :
                        meta.exercise === 'sometimes' ? '🚶 أحياناً' : '🛋️ منقطع'
                    }</div>
                        </div>
                        <div style="background: white; padding: 0.75rem; border-radius: 8px; border: 1px solid #E2E8F0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                            <div style="font-size: 0.75rem; color: #94A3B8; margin-bottom: 0.2rem;">استهلاك السكر</div>
                            <div style="font-weight: 700; color: #1E293B;">${meta.sugar_intake === 'high' ? '🍬 مرتفع' :
                        meta.sugar_intake === 'medium' ? '🍬 متوسط' : '🍬 منخفض'
                    }</div>
                        </div>
                    </div>
                `;
            } else {
                aiHealthCard.style.display = 'none';
            }
        } catch (err) {
            console.error('Health assessment load error:', err);
            aiHealthCard.style.display = 'none';
        }

        // ─── Fetch Real Data from API ───
        const healthRes = await api.health.elderData(elderId, 7);
        const records = healthRes.records || [];

        // Tracking 6 core emotions
        let happyCount = 0, naturalCount = 0, surpriseCount = 0;
        let sadCount = 0, angryCount = 0, disgustCount = 0;

        let riskCount = 0;
        let latestMood = 'لم يحدد';
        let moodScoreTotal = 0, moodScoreCount = 0;
        const aiAlerts = [];

        records.forEach(r => {
            if (r.moodLabel) {
                const label = r.moodLabel.toLowerCase().trim();
                // Standardize labels (handle aliases and the 'natural' vs 'neutral' conflict)
                let mapped = label;
                if (label === 'neutral' || label === 'natural') mapped = 'natural';
                if (label === 'surprised' || label === 'surprise') mapped = 'surprise';
                if (label === 'disgusted' || label === 'disgust') mapped = 'disgust';

                // Count for charts
                if (mapped === 'happy') happyCount++;
                else if (mapped === 'natural') naturalCount++;
                else if (mapped === 'surprise') surpriseCount++;
                else if (mapped === 'sad') { sadCount++; riskCount++; }
                else if (mapped === 'angry') { angryCount++; riskCount++; }
                else if (mapped === 'disgust') { disgustCount++; riskCount++; }
                else naturalCount++; // Fallback

                // Average stability score
                if (r.moodScore) {
                    moodScoreTotal += r.moodScore;
                    moodScoreCount++;
                }

                // Recent history
                if (aiAlerts.length < 4) {
                    const isRisk = ['sad', 'angry', 'disgust'].includes(mapped);
                    const emojis = { happy: '😊', sad: '😔', angry: '😠', surprise: '😲', natural: '😐', disgust: '🤢' };
                    const arabicNames = { happy: 'سعيد', sad: 'حزين', angry: 'غاضب', surprise: 'متفاجئ', natural: 'طبيعي', disgust: 'مشمئز' };
                    aiAlerts.push({
                        time: timeAgo(r.recordedAt),
                        desc: `تحليل الوجه: ${emojis[mapped] || '😐'} حالة ${arabicNames[mapped] || mapped} (تقييم ${r.moodScore})`,
                        type: isRisk ? 'RISK' : 'NORMAL'
                    });
                }
            }
        });


        // Fallbacks if no data yet (show balanced neutral)
        const totalCount = happyCount + naturalCount + surpriseCount + sadCount + angryCount + disgustCount;
        if (totalCount === 0) {
            naturalCount = 100;
        }

        // Get latest mood specifically from either records or latest alerts
        const latestMoodRecord = records.find(r => r.moodLabel);
        if (latestMoodRecord) {
            const label = latestMoodRecord.moodLabel.toLowerCase().trim();
            let mapped = label;
            if (label === 'neutral' || label === 'natural') mapped = 'natural';
            if (label === 'surprised' || label === 'surprise') mapped = 'surprise';
            if (label === 'disgusted' || label === 'disgust') mapped = 'disgust';

            const emojis = { happy: 'سعيد 😊', sad: 'حزين 😔', angry: 'غاضب 😠', surprise: 'متفاجئ 😲', natural: 'طبيعي 😐', disgust: 'مشمئز 🤢' };
            latestMood = emojis[mapped] || latestMoodRecord.moodLabel;
        }


        const stabilityScore = moodScoreCount ? Math.round((moodScoreTotal / moodScoreCount) * 100) : 85;
        const globalStatus = riskCount > 0 ? '<span style="background: rgba(239, 68, 68, 0.2); color: #EF4444; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; border: 1px solid rgba(239,68,68,0.3);">يوجد بيانات سلبية ⚠️</span>' : '<span style="background: rgba(34, 197, 94, 0.2); color: #4ADE80; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; border: 1px solid rgba(34,197,94,0.3);">إيجابي/طبيعي ✅</span>';
        const stabilityColor = stabilityScore > 70 ? '#4ADE80' : stabilityScore > 40 ? '#F5A623' : '#EF4444';

        // Prepare chart data array for the 6 emotions
        const moodDataObj = {
            labels: ['سعيد 🟩', 'محايد 🟦', 'متفاجئ 🟧', 'حزين 🟪', 'غاضب 🟥', 'مشمئز 🟫'],
            data: [happyCount, naturalCount, surpriseCount, sadCount, angryCount, disgustCount],
            colors: ['#22C55E', '#94A3B8', '#F5A623', '#8B5CF6', '#EF4444', '#92400E']
        };

        if (!aiAlerts.length) {
            aiAlerts.push({ time: 'الآن', desc: 'في انتظار بيانات مسح الوجوه من الكاميرا...', type: 'NORMAL' });
        }

        const aiAlertsHtml = aiAlerts.map(a => `
            <div style="background:rgba(255,255,255,0.1); padding:0.8rem; border-radius:6px; margin-bottom:0.5rem; border-right:3px solid ${a.type === 'RISK' ? '#EF4444' : '#22C55E'};">
                <div style="font-size:0.75rem; color:#CBD5E1; margin-bottom:0.2rem;">${a.time}</div>
                <div style="font-size:0.85rem; font-weight:600;">${a.desc}</div>
            </div>
        `).join('');

        const stats = { confirmed: 42, missed: 3, snoozed: 5, pending: 1 };
        const labels = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
        const heartRates = [72, 75, 71, 78, 82, 74, 76];
        const oxygenLevels = [98, 97, 98, 99, 96, 97, 98];
        const bloodPressureSys = [120, 122, 118, 125, 130, 121, 119];

        // Prepare distribution details
        const breakdownHtml = [
            { label: 'سعيد 😊', count: happyCount, color: '#22C55E' },
            { label: 'طبيعي 😐', count: naturalCount, color: '#94A3B8' },
            { label: 'متفاجئ 😲', count: surpriseCount, color: '#F5A623' },
            { label: 'حزين 😔', count: sadCount, color: '#8B5CF6' },
            { label: 'غاضب 😠', count: angryCount, color: '#EF4444' },
            { label: 'مشمئز 🤢', count: disgustCount, color: '#92400E' }
        ].map(b => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.08); padding:0.4rem 0.7rem; border-radius:8px; border-right:2px solid ${b.color};">
                <span style="font-size:0.75rem; color:#E2E8F0;">${b.label}</span>
                <span style="font-weight:700; color:white; font-size:0.8rem;">${b.count}</span>
            </div>
        `).join('');

        const container = document.getElementById('reportContent');
        container.innerHTML = `
            <div style="font-size:1.1rem; font-weight:700; color:#1E293B; margin-bottom:1rem; display:flex; gap:0.5rem;"><span style="color:var(--primary);">🏥</span> الحالة الصحية العامة (Sensors)</div>
            
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
                <!-- Vitals Sensors -->
                <div style="text-align:center; padding:1rem; background:linear-gradient(135deg, #EFF6FF, #DBEAFE); border-radius:var(--radius-lg); box-shadow:0 2px 10px rgba(59,130,246,0.1);">
                    <div style="font-size:1.8rem; font-weight:800; color:#2563EB;">${heartRates[6]}</div><div style="font-size:0.8rem; color:#1D4ED8;">نبض القلب ♥️</div>
                </div>
                <div style="text-align:center; padding:1rem; background:linear-gradient(135deg, #FFF7ED, #FFEDD5); border-radius:var(--radius-lg); box-shadow:0 2px 10px rgba(245,166,35,0.1);">
                    <div style="font-size:1.8rem; font-weight:800; color:#EA580C;">%${oxygenLevels[6]}</div><div style="font-size:0.8rem; color:#C2410C;">معدل الأكسجين 💨</div>
                </div>
                <div style="text-align:center; padding:1rem; background:linear-gradient(135deg, #F0FFF4, #DCFCE7); border-radius:var(--radius-lg); box-shadow:0 2px 10px rgba(34,197,94,0.1);">
                    <div style="font-size:1.8rem; font-weight:800; color:#16A34A;">${stats.confirmed}</div><div style="font-size:0.8rem; color:#15803D;">أدوية مكتملة 💊</div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; margin-bottom:2rem;">
                <div style="background:white; border:1px solid #E2E8F0; padding:1.5rem; border-radius:var(--radius-lg);">
                    <div style="font-size:1rem; font-weight:700; color:#475569; margin-bottom:1rem;">♥️ تحليل نبضات القلب (أسبوع)</div>
                    <canvas id="heartChart" style="max-height: 250px;"></canvas>
                </div>
                <div style="background:white; border:1px solid #E2E8F0; padding:1.5rem; border-radius:var(--radius-lg);">
                    <div style="font-size:1rem; font-weight:700; color:#475569; margin-bottom:1rem;">🩸 ضغط الدم الانقباضي</div>
                    <canvas id="bpChart" style="max-height: 250px;"></canvas>
                </div>
            </div>

            <!-- CV and AI Section -->
            <div style="font-size:1.2rem; font-weight:800; color:#DC2626; margin-bottom:1rem; display:flex; align-items:center; gap:0.6rem; border-top: 2px solid #F1F5F9; padding-top: 1.5rem;">
                <span style="background: #FEF2F2; padding: 0.4rem; border-radius: 8px;">😊</span>
                تقرير أبحاث الذكاء الاصطناعي (Computer Vision)
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem;">
                
                <!-- Mood Chart Section -->
                <div style="background:linear-gradient(135deg, #F8FAFC 0%, #FFFFFF 100%); border:1px solid rgba(27,95,173,0.1); padding:2rem; border-radius:var(--radius-lg); box-shadow: 0 10px 25px rgba(0,0,0,0.02); display: flex; flex-direction: column; align-items: center; min-height: 450px;">
                    <div style="font-size:1.1rem; font-weight:700; color:#0E2240; margin-bottom:1rem; align-self: flex-start; width: 100%; border-bottom: 1px solid #E2E8F0; padding-bottom: 0.5rem;">
                        إحصائيات المشاعر الشاملة 📊
                    </div>
                    <div style="position: relative; width: 100%; max-width: 420px; flex: 1; display:flex; align-items:center; justify-content:center;">
                        <canvas id="moodChart" style="z-index: 2; width: 100%; height: 100%;"></canvas>
                        <div style="position: absolute; top: 41%; left: 50%; transform: translate(-50%, -50%); text-align: center; z-index: 1; pointer-events: none;">
                            <div style="font-size: 3.5rem; line-height: 1; margin-bottom:0.2rem;">${latestMood.split(' ')[1] || '😊'}</div>
                        </div>

                    </div>
                </div>


                <!-- Mood Details Section -->
                <div style="background:linear-gradient(135deg, #0E2240, #1B5FAD); padding:1.5rem; border-radius:var(--radius-lg); color:white; box-shadow: 0 10px 25px rgba(27,95,173,0.2);">
                    <div style="font-size:1.1rem; font-weight:700; margin-bottom:1.5rem; display:flex; justify-content: space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:0.5rem;">📑 تفاصيل الحالة النفسية</div>
                        ${globalStatus}
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                            <div style="font-size: 0.75rem; color: #94A3B8; margin-bottom: 0.3rem;">المزاج السائد (آخر قراءة)</div>
                            <div style="font-size: 1.2rem; font-weight: 700; color: white;">${latestMood}</div>
                        </div>
                        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                            <div style="font-size: 0.75rem; color: #94A3B8; margin-bottom: 0.3rem;">تحذيرات (Risk)</div>
                            <div style="font-size: 1.2rem; font-weight: 700; color: ${riskCount > 0 ? '#FCA5A5' : 'white'};">${riskCount > 0 ? riskCount + ' إنذارات' : '0 إنذارات'}</div>
                        </div>
                        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); grid-column: 1 / -1;">
                            <div style="font-size: 0.75rem; color: #94A3B8; margin-bottom: 0.3rem;">مؤشر الاستقرار النفسي</div>
                            <div style="width: 100%; background: rgba(255,255,255,0.1); border-radius: 10px; height: 10px; overflow: hidden; margin-top: 0.5rem;">
                                <div style="width: ${stabilityScore}%; background: ${stabilityColor}; height: 100%; border-radius: 10px; transition: width 1s;"></div>
                            </div>
                            <div style="text-align: right; font-size: 0.75rem; color: ${stabilityColor}; margin-top: 0.3rem;">استقرار بنسبة ${stabilityScore}%</div>
                        </div>
                    </div>
                    
                    <div style="font-size: 0.9rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.8rem;">سجل تحليل الوجه (Live History):</div>
                    ${aiAlertsHtml}

                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                        <div style="font-size: 0.85rem; font-weight: 600; color: #94A3B8; margin-bottom: 0.8rem;">موجز الحالات المرصودة:</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                            ${breakdownHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;

        setTimeout(() => {
            // Heart rate chart
            if (document.getElementById('heartChart')) {
                new Chart(document.getElementById('heartChart'), {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{ label: 'النبض (bpm)', data: heartRates, borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 3, tension: 0.4, fill: true, pointBackgroundColor: '#EF4444', pointRadius: 4 }]
                    },
                    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { min: 60, max: 100 } } }
                });
            }

            // Mood Doughnut - Advanced Setup
            if (document.getElementById('moodChart')) {
                new Chart(document.getElementById('moodChart'), {
                    type: 'doughnut',
                    data: {
                        labels: moodDataObj.labels,
                        datasets: [{
                            data: moodDataObj.data,
                            backgroundColor: moodDataObj.colors,
                            borderWidth: 2,
                            borderColor: '#FFFFFF',
                            hoverOffset: 10
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        layout: { padding: 15 },
                        plugins: {
                            legend: {
                                position: 'bottom',
                                align: 'center',
                                labels: {
                                    font: { family: 'Cairo', size: 12, weight: '600' },
                                    padding: 15,
                                    usePointStyle: true,
                                    pointStyle: 'circle'
                                }
                            },
                            tooltip: {
                                bodyFont: { family: 'Cairo', size: 14 }
                            }
                        },
                        cutout: '70%',

                    }
                });
            }

            // Blood Pressure
            if (document.getElementById('bpChart')) {
                new Chart(document.getElementById('bpChart'), {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{ label: 'الضغط (mmHg)', data: bloodPressureSys, backgroundColor: '#3B82F6', borderRadius: 4 }]
                    },
                    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { min: 100, max: 150 } } }
                });
            }
        }, 150);
    } catch (err) {
        console.error('Reports error:', err);
    }
}

// ─── Management Tab ───────────────────────────────────────────────────────────
async function loadManagementTab(elderId) {
    if (!elderId) return;

    const typeMap = { MEDICINE: { icon: '💊', color: '#EF4444' }, MEAL: { icon: '🍽️', color: '#F5A623' }, WATER: { icon: '💧', color: '#0EA5E9' }, EXERCISE: { icon: '🏃', color: '#22C55E' }, APPOINTMENT: { icon: '📅', color: '#1B5FAD' }, CUSTOM: { icon: '🔔', color: '#2BBFB3' } };
    const eventTypeEmojis = { DOCTOR: '🏥', BANK: '🏦', VISIT: '👥', CUSTOM: '📌' };
    const repeatLabels = { DAILY: 'يومي', WEEKLY: 'أسبوعي', MONTHLY: 'شهري', ONCE: 'مرة' };

    try {
        const today = new Date().toISOString().split('T')[0];
        const month = today.substring(0, 7);
        const user = getUser();

        // Fetch all data in parallel
        const [remData, schedData, calData, alertData, msgData, locData] = await Promise.all([
            api.reminders.list(elderId).catch(() => ({ reminders: [] })),
            api.reminders.history(elderId, 1).catch(() => ({ stats: {} })),
            api.calendar.list(elderId, month).catch(() => ({ events: [] })),
            api.alerts.list().catch(() => ({ alerts: [] })),
            api.messages.conversation(elderId, 10).catch(() => ({ messages: [] })),
            api.location.get(elderId).catch(() => ({ location: null }))
        ]);

        const reminders = remData.reminders || [];
        const events = calData.events || [];
        const todayEvents = events.filter(e => e.date === today);
        const alerts = (alertData.alerts || []).slice(0, 5);
        const messages = msgData.messages || [];
        const loc = locData.location;

        // ── Schedule (reminders + today events merged) ──
        const schedItems = [];
        reminders.filter(r => r.isActive).forEach(r => {
            const t = typeMap[r.type] || typeMap.CUSTOM;
            schedItems.push({ time: r.scheduledTime, title: r.title, icon: t.icon, type: 'reminder' });
        });
        todayEvents.forEach(e => {
            schedItems.push({ time: e.time || '—', title: e.title, icon: eventTypeEmojis[e.type] || '📌', type: 'event' });
        });
        schedItems.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

        const schedEl = document.getElementById('mgmtSchedule');
        if (schedItems.length) {
            schedEl.innerHTML = schedItems.map(s => `
                <div style="display:flex; align-items:center; gap:0.75rem; padding:0.6rem 0; border-bottom:1px solid #E2E8F0;">
                    <span style="font-weight:700; min-width:50px; color:var(--primary);">${s.time}</span>
                    <span style="font-size:1.1rem;">${s.icon}</span>
                    <span style="font-weight:500; flex:1;">${s.title}</span>
                    <span style="font-size:0.7rem; color:#94A3B8; background:#F1F5F9; padding:2px 6px; border-radius:4px;">${s.type === 'reminder' ? 'تذكير' : 'حدث'}</span>
                </div>
            `).join('');
        } else {
            schedEl.innerHTML = '<p style="color:#94A3B8; text-align:center; font-size:0.85rem;">لا يوجد جدول لليوم</p>';
        }

        // ── Reminders ──
        const remEl = document.getElementById('mgmtReminders');
        if (reminders.length) {
            remEl.innerHTML = reminders.slice(0, 6).map(r => {
                const t = typeMap[r.type] || typeMap.CUSTOM;
                return `
                <div style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0; border-bottom:1px solid #E2E8F0; ${!r.isActive ? 'opacity:0.5;' : ''}">
                    <span style="font-size:1.1rem;">${t.icon}</span>
                    <div style="flex:1;"><div style="font-weight:600; font-size:0.85rem;">${r.title}</div><div style="font-size:0.7rem; color:#94A3B8;">${r.scheduledTime} • ${repeatLabels[r.repeatRule] || ''}</div></div>
                    <button style="background:none;border:none;cursor:pointer;font-size:0.85rem;" onclick="deleteReminder('${r.id}')" title="حذف">🗑️</button>
                </div>`;
            }).join('');
        } else {
            remEl.innerHTML = '<p style="color:#94A3B8; text-align:center; font-size:0.85rem;">لا توجد تذكيرات</p>';
        }

        // ── Calendar Events ──
        const evtEl = document.getElementById('mgmtEvents');
        if (events.length) {
            evtEl.innerHTML = events.slice(0, 6).map(e => `
                <div style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0; border-bottom:1px solid #E2E8F0;">
                    <span style="font-size:1rem;">${eventTypeEmojis[e.type] || '📌'}</span>
                    <div style="flex:1;"><div style="font-weight:600; font-size:0.85rem;">${e.title}</div><div style="font-size:0.7rem; color:#94A3B8;">${e.date} ${e.time || ''}</div></div>
                    <button style="background:none;border:none;cursor:pointer;font-size:0.85rem;" onclick="editEventInModal('${e.id}')" title="تعديل">✏️</button>
                    <button style="background:none;border:none;cursor:pointer;font-size:0.85rem;" onclick="deleteEvent('${e.id}')" title="حذف">🗑️</button>
                </div>
            `).join('');
        } else {
            evtEl.innerHTML = '<p style="color:#94A3B8; text-align:center; font-size:0.85rem;">لا توجد مواعيد</p>';
        }

        // ── Alerts ──
        const alertEl = document.getElementById('mgmtAlerts');
        if (alerts.length) {
            const icons = { FALL: '🚨', FIRE: '🔥', MOOD: '😔', HEALTH: '💓', EMERGENCY: '🚨', MANUAL: '📌', default: '⚠️' };
            alertEl.innerHTML = alerts.map(a => `
                <div style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0; border-bottom:1px solid #E2E8F0;">
                    <span style="font-size:1rem;">${icons[a.type] || icons.default}</span>
                    <div style="flex:1;"><div style="font-weight:600; font-size:0.82rem;">${a.message}</div><div style="font-size:0.7rem; color:#94A3B8;">${timeAgo(a.createdAt)} • ${a.severity}</div></div>
                    ${!a.isRead ? '<span style="width:6px;height:6px;border-radius:50%;background:var(--danger);"></span>' : ''}
                </div>
            `).join('');
        } else {
            alertEl.innerHTML = '<p style="color:#94A3B8; text-align:center; font-size:0.85rem;">لا توجد تنبيهات</p>';
        }

        // ── Chat ──
        const chatEl = document.getElementById('mgmtChat');
        if (messages.length) {
            chatEl.innerHTML = messages.slice(0, 5).map(m => {
                const isSent = m.senderId === user.id;
                return `
                <div style="display:flex; gap:0.5rem; padding:0.4rem 0; border-bottom:1px solid #E2E8F0;">
                    <span style="font-size:0.85rem;">${isSent ? '➤' : '◄'}</span>
                    <div style="flex:1;"><div style="font-size:0.82rem; ${isSent ? 'color:#64748B;' : 'font-weight:600;'}">${escapeHtml(m.content).substring(0, 60)}${m.content.length > 60 ? '...' : ''}</div><div style="font-size:0.65rem; color:#94A3B8;">${formatTime(m.createdAt)}</div></div>
                </div>`;
            }).join('');
        } else {
            chatEl.innerHTML = '<p style="color:#94A3B8; text-align:center; font-size:0.85rem;">لا توجد رسائل</p>';
        }

        // ── Location ──
        const locEl = document.getElementById('mgmtLocation');
        if (loc) {
            locEl.innerHTML = `
                <div style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
                    <div>
                        <div style="font-size:0.82rem; color:#64748B;">خط العرض: <strong>${loc.latitude.toFixed(6)}</strong></div>
                        <div style="font-size:0.82rem; color:#64748B;">خط الطول: <strong>${loc.longitude.toFixed(6)}</strong></div>
                        ${loc.accuracy ? `<div style="font-size:0.82rem; color:#64748B;">الدقة: <strong>${Math.round(loc.accuracy)}م</strong></div>` : ''}
                        <div style="font-size:0.82rem; color:#64748B;">آخر تحديث: <strong>${timeAgo(loc.createdAt)}</strong></div>
                    </div>
                    <a href="https://www.google.com/maps?q=${loc.latitude},${loc.longitude}" target="_blank" class="btn btn-primary btn-sm" style="font-size:0.8rem;">📍 فتح الخريطة</a>
                </div>
            `;
        } else {
            locEl.innerHTML = '<p style="color:#94A3B8; text-align:center; font-size:0.85rem;">لا يوجد موقع مُسجل بعد</p>';
        }
    } catch (err) {
        console.error('Management tab error:', err);
    }
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// ─── Logout ───────────────────────────────────────────────────────────────────
function logout() {
    clearInterval(pollInterval);
    clearAuth();
    window.location.href = '/index.html';
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
async function loadSettingsTab() {
    try {
        const data = await api.auth.me();
        const user = data.user || data; // handle depending on response shape

        // Update user storage
        setAuth(getToken(), user);

        document.getElementById('sidebarUserName').textContent = user.name;

        // Profile Form
        document.getElementById('settingMonitorId').value = user.shareCode || user.id || '';
        const monitorLinkStr = user.shareCode ? `${window.location.origin}/link-elder.html?code=${user.shareCode}` : 'لا يوجد كود نشط — اذهب لصفحة الربط';
        document.getElementById('settingMonitorLink').value = monitorLinkStr;
        document.getElementById('settingMonitorName').value = user.name || '';
        document.getElementById('settingMonitorEmail').value = user.email || '';
        document.getElementById('settingMonitorPhone').value = user.phone || '';


        // Password Form
        document.getElementById('settingOldPass').value = '';
        document.getElementById('settingNewPass').value = '';
        document.getElementById('settingConfirmPass').value = '';

        // Managed Elders
        const tableBody = document.getElementById('managedEldersList');
        if (!elders || elders.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="padding:2rem; text-align:center; color:#94A3B8;">لا يوجد كبار سن مرتبطين بك</td></tr>';
        } else {
            tableBody.innerHTML = elders.map(c => {
                const elder = c.elder;
                const linkStr = elder.connectUrl || (elder.shareCode ? `${window.location.origin}/link-elder.html?code=${elder.shareCode}` : '—');
                return `

                    <tr style="text-align:right; border-bottom:1px solid #E2E8F0;">
                        <td style="padding:1rem;">👴 ${elder.name}</td>
                        <td style="padding:1rem; font-family:monospace; direction:ltr; text-align:right;">${elder.shareCode || elder.id}</td>
                        <td style="padding:1rem;">
                            <div style="display:flex; align-items:center; gap:0.5rem; justify-content:flex-start;">
                                <input type="text" readonly value="${linkStr}" style="background:#F1F5F9; border:none; padding:0.25rem 0.5rem; font-size:0.75rem; border-radius:4px; width:150px; direction:ltr;" id="link_${elder.id}" />
                                <button class="btn btn-sm" onclick="copyValue('link_${elder.id}')" style="padding:0.2rem 0.5rem;">📋</button>
                            </div>
                        </td>
                        <td style="padding:1rem;">${formatDate(c.createdAt)}</td>
                    </tr>
                `;
            }).join('');
        }
    } catch (err) {
        showToast('خطأ في تحميل الإعدادات', 'error');
        console.error('Settings error:', err);
    }
}

async function updateMonitorProfile() {
    const name = document.getElementById('settingMonitorName').value.trim();
    const phone = document.getElementById('settingMonitorPhone').value.trim();

    if (!name) {
        showToast('الاسم مطلوب', 'warning');
        return;
    }

    try {
        await api.auth.update({ name, phone });

        // Update user locally
        const user = getUser();
        if (user) {
            user.name = name;
            user.phone = phone;
            setAuth(getToken(), user);
        }

        document.getElementById('sidebarUserName').textContent = name;
        showToast('تم تحديث الملف الشخصي ✅', 'success');
    } catch (err) {
        showToast(err.message || 'خطأ في التحديث', 'error');
    }
}

async function updateMonitorPassword() {
    const oldPassword = document.getElementById('settingOldPass').value;
    const newPassword = document.getElementById('settingNewPass').value;
    const confirmPassword = document.getElementById('settingConfirmPass').value;

    if (!oldPassword || !newPassword || !confirmPassword) {
        showToast('جميع الحقول مطلوبة', 'warning');
        return;
    }

    if (newPassword !== confirmPassword) {
        showToast('كلمة السر الجديدة غير متطابقة', 'warning');
        return;
    }

    if (newPassword.length < 6) {
        showToast('كلمة السر يجب أن تكون 6 أحرف على الأقل', 'warning');
        return;
    }

    try {
        await api.auth.changePassword({ oldPassword, newPassword });
        showToast('تم تغيير كلمة السر بنجاح 🔒', 'success');
        document.getElementById('settingOldPass').value = '';
        document.getElementById('settingNewPass').value = '';
        document.getElementById('settingConfirmPass').value = '';
    } catch (err) {
        showToast(err.message || 'خطأ في تغيير كلمة السر', 'error');
    }
}

function copyValue(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.select();
    el.setSelectionRange(0, 99999);

    navigator.clipboard.writeText(el.value).then(() => {
        showToast('تم النسخ', 'info');
    }).catch(err => {
        showToast('فشل النسخ', 'error');
        console.error('Copy failed', err);
    });
}
// ─── AI Lab Logic ────────────────────────────────────────────────────────────
async function triggerTestMood(emotion) {
    if (!selectedElderId) {
        showToast('برجاء اختيار كبير سن من القائمة أولاً لتوجيه المحاكاة', 'warning');
        return;
    }
    const btnId = `testMood${emotion}Btn`;
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.7';
    }

    try {
        // Mood Detection FastAPI is on Port 8014
        const res = await fetch(`http://localhost:8014/test/${emotion}?elder_id=${selectedElderId}`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error('سيرفر الذكاء الاصطناعي لا يستجيب');

        showToast(`تم إرسال محاكاة حالة ${emotion} بنجاح ✅`, 'success');

        // Reload data if we are in Reports
        if (currentTab === 'reports') {
            setTimeout(loadReportsTab, 1500);
        }
    } catch (err) {
        showToast('عذراً، تأكد من تشغيل Emotion Detection API (Port 8011)', 'error');
        console.error('Mood simulation error:', err);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    }
}

async function triggerTestFire() {
    return triggerFireSimulation('fire', 'testFireBtn');
}

async function triggerTestSmoke() {
    return triggerFireSimulation('smoke', 'testSmokeBtn');
}

async function triggerTestFireSmoke() {
    return triggerFireSimulation('fire_smoke', 'testFireSmokeBtn');
}

async function triggerFireSimulation(type, btnId) {
    if (!selectedElderId) {
        showToast('برجاء اختيار كبير سن أولاً لإصدار إنذار الحريق', 'warning');
        return;
    }
    const btn = document.getElementById(btnId);
    if (btn) btn.disabled = true;

    try {
        // Fire & Smoke FastAPI is on Port 8013
        const endpoint = type === 'fire_smoke' ? 'fire_smoke' : type;
        const res = await fetch(`http://localhost:8013/test/${endpoint}?elder_id=${selectedElderId}`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error('سيرفر الحريق لا يستجيب');

        showToast(`🔥 تم إرسال محاكاة ${type} تجريبية بنجاح!`, 'success');
        loadAlerts(); // Refresh alerts list
    } catch (err) {
        showToast('عذراً، تأكد من تشغيل Fire Detection API (Port 8010)', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function triggerTestFall() {
    if (!selectedElderId) {
        showToast('برجاء اختيار كبير سن أولاً لإرسال محاكاة السقوط', 'warning');
        return;
    }
    const btn = document.getElementById('testFallBtn');
    if (btn) btn.disabled = true;

    try {
        // Fall Detection FastAPI is on Port 8012
        const res = await fetch(`http://localhost:8012/test/fall?elder_id=${selectedElderId}`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error('سيرفر كشف السقوط لا يستجيب');

        showToast('🧍 تم إرسال محاكاة سقوط تجريبية بنجاح!', 'success');
        loadAlerts(); // Refresh alerts list
    } catch (err) {
        showToast('عذراً، تأكد من تشغيل Fall Detection API (Port 8012)', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ─── AI Video Evidence Viewer ────────────────────────────────────────────────
function viewVideoEvidence(url, metadata) {
    const modal = document.getElementById('videoModal');
    const video = document.getElementById('evidenceVideo');
    const metaContainer = document.getElementById('videoMeta');
    const loader = document.getElementById('videoLoading');

    if (!modal || !video) return;

    // Show modal
    modal.classList.add('active');

    // Reset video
    video.pause();
    video.src = '';
    if (loader) loader.style.display = 'block';

    // Set Meta
    if (metaContainer) {
        let metaHtml = '';
        if (metadata.fall_detected) metaHtml += '🚨 <strong style="color:#EF4444;">تم رصد حالة سقوط مؤكدة</strong><br>';
        if (metadata.alarm_type) metaHtml += `🔥 <strong style="color:#EF4444;">تنبيه: ${metadata.alarm_type.toUpperCase()}</strong><br>`;
        if (metadata.best_emotion) metaHtml += `😊 <strong style="color:var(--accent);">الحالة المكتشفة: ${metadata.best_emotion.toUpperCase()}</strong><br>`;
        if (metadata.status === 'risk') metaHtml += '⚠️ <strong style="color:#EF4444;">تحذير: حالة نفسية غير مستقرة</strong><br>';
        if (metadata.confidence) metaHtml += `🎯 دقة الكشف: ${(metadata.confidence * 100).toFixed(1)}%<br>`;
        if (metadata.max_confidence) metaHtml += `🎯 دقة الكشف: ${(metadata.max_confidence * 100).toFixed(1)}%<br>`;
        metaContainer.innerHTML = metaHtml || 'دليل معالج بواسطة محرك SANAD للذكاء الاصطناعي';
    }

    // Load and Play
    video.src = url;
    video.load();
    video.oncanplay = () => {
        if (loader) loader.style.display = 'none';
        video.play().catch(e => console.log('Autoplay blocked'));
    };

    video.onerror = () => {
        if (loader) loader.innerHTML = '❌ فشل تحميل الفيديو. يرجى التأكد من تشغيل سيرفر الخدمة.';
    };
}

// Ensure Modal Close triggers Stop
const oldCloseModal = window.closeModal;
window.closeModal = function (id) {
    if (id === 'videoModal') {
        const video = document.getElementById('evidenceVideo');
        if (video) {
            video.pause();
            video.src = '';
        }
    }
    if (typeof oldCloseModal === 'function') oldCloseModal(id);
};
