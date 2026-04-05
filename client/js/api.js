/**
 * SANAD - سند | API Client
 * Handles all HTTP requests to the backend.
 * Automatically attaches JWT token, handles 401 errors.
 */

const API_BASE = '/api';

// ─── Token Management ─────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('ec_token');
const getUser = () => {
    const u = localStorage.getItem('ec_user');
    return u ? JSON.parse(u) : null;
};
const setAuth = (token, user) => {
    localStorage.setItem('ec_token', token);
    localStorage.setItem('ec_user', JSON.stringify(user));
};
const clearAuth = () => {
    localStorage.removeItem('ec_token');
    localStorage.removeItem('ec_user');
};

// ─── Core Fetch Wrapper ───────────────────────────────────────────────────────
const request = async (method, path, body = null, opts = {}) => {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...opts.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    try {
        const res = await fetch(`${API_BASE}${path}`, config);
        const data = await res.json().catch(() => ({}));

        if (res.status === 401) {
            clearAuth();
            window.location.href = '/index.html';
            return;
        }

        if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }

        return data;
    } catch (err) {
        if (err.message.includes('fetch')) {
            throw new Error('تعذر الاتصال بالسيرفر — تأكد إن السيرفر شغال');
        }
        throw err;
    }
};

// ─── Convenience Methods ──────────────────────────────────────────────────────
const api = {
    get: (path, opts) => request('GET', path, null, opts),
    post: (path, body, opts) => request('POST', path, body, opts),
    put: (path, body, opts) => request('PUT', path, body, opts),
    delete: (path, opts) => request('DELETE', path, null, opts),

    // Auth
    auth: {
        register: (data) => api.post('/auth/register', data),
        login: (data) => api.post('/auth/login', data),
        me: () => api.get('/auth/me'),
        update: (data) => api.put('/auth/profile', data),
        changePassword: (data) => api.put('/profile/password', data)
    },

    // Connections
    connections: {
        generate: () => api.post('/connections/generate'),
        info: (code) => api.get(`/connections/info/${code}`),
        accept: (code) => api.post(`/connections/accept/${code}`),
        reject: (code) => api.post(`/connections/reject/${code}`),
        myElders: () => api.get('/connections/my-elders'),
        myMonitor: () => api.get('/connections/my-monitor'),
        delete: (id) => api.delete(`/connections/${id}`)
    },

    // Reminders
    reminders: {
        create: (data) => api.post('/reminders', data),
        list: (elderId) => api.get(`/reminders/elder/${elderId}`),
        active: () => api.get('/reminders/active'),
        schedule: () => api.get('/reminders/schedule'),
        update: (id, data) => api.put(`/reminders/${id}`, data),
        delete: (id) => api.delete(`/reminders/${id}`),
        confirm: (logId) => api.post(`/reminders/log/${logId}/confirm`),
        snooze: (logId, minutes) => api.post(`/reminders/log/${logId}/snooze`, { minutes }),
        history: (elderId, days) => api.get(`/reminders/history/${elderId}?days=${days || 7}`)
    },

    // Alerts
    alerts: {
        list: (params) => api.get(`/alerts${params ? '?' + new URLSearchParams(params) : ''}`),
        myAlerts: () => api.get('/alerts/my-alerts'),
        manual: (data) => api.post('/alerts/manual', data),
        markRead: (id) => api.put(`/alerts/${id}/read`),
        readAll: () => api.put('/alerts/read-all'),
        emergency: (data) => api.post('/alerts/emergency', data),
        saveHealthAssessment: (data) => api.post('/alerts/health-assessment', data)
    },

    // Chat
    chat: {
        send: (content) => api.post('/chat/message', { content }),
        history: (limit) => api.get(`/chat/history?limit=${limit || 50}`),
        clear: () => api.delete('/chat/history')
    },

    // Health
    health: {
        elderData: (elderId, days) => api.get(`/health/elder/${elderId}?days=${days || 7}`)
    },

    // Direct Messages (Elder ↔ Monitor)
    messages: {
        send: (receiverId, content) => api.post('/messages/send', { receiverId, content }),
        conversation: (userId, limit) => api.get(`/messages/conversation/${userId}?limit=${limit || 50}`),
        markRead: (userId) => api.put(`/messages/read/${userId}`),
        unreadCount: () => api.get('/messages/unread-count')
    },

    // Calendar Events
    calendar: {
        create: (data) => api.post('/calendar', data),
        list: (elderId, month) => api.get(`/calendar/elder/${elderId}${month ? '?month=' + month : ''}`),
        myEvents: (month) => api.get(`/calendar/my-events${month ? '?month=' + month : ''}`),
        update: (id, data) => api.put(`/calendar/${id}`, data),
        delete: (id) => api.delete(`/calendar/${id}`)
    },

    // Location Tracking
    location: {
        update: (latitude, longitude, accuracy) => api.post('/location/update', { latitude, longitude, accuracy }),
        get: (elderId) => api.get(`/location/elder/${elderId}`)
    },

    // AI Services (Direct microservice calls)
    ai: {
        // Health Risk AI (Port 8015)
        predictHealth: (data) => fetch('http://localhost:8015/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then(res => res.json()),

        // Mood/Emotion AI (Port 8014)
        testMood: (emotion, elderId) => fetch(`http://localhost:8014/test/${emotion}?elder_id=${elderId}`, {
            method: 'POST'
        }).then(res => res.json()),

        detectEmotionImage: (formData, elderId) => fetch(`http://localhost:8014/detect/emotion/image?elder_id=${elderId}`, {
            method: 'POST',
            body: formData
        }).then(res => res.json()),

        detectEmotionVideo: (formData, elderId) => fetch(`http://localhost:8014/detect/emotion/video?elder_id=${elderId}`, {
            method: 'POST',
            body: formData
        }).then(res => res.json())
    }
};

// ─── Toast Notification Helper ────────────────────────────────────────────────
const showToast = (message, type = 'info', duration = 4000) => {
    const container = document.getElementById('toast-container') || (() => {
        const c = document.createElement('div');
        c.id = 'toast-container';
        c.className = 'toast-container';
        document.body.appendChild(c);
        return c;
    })();

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type] || '📢'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-20px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
};

// ─── Auth Guard ───────────────────────────────────────────────────────────────
const requireAuth = (role = null) => {
    const user = getUser();
    const token = getToken();

    if (!user || !token) {
        window.location.href = '/index.html';
        return null;
    }

    if (role && user.role !== role) {
        showToast('مش مسموحلك بدخول الصفحة دي', 'error');
        const redirect = user.role === 'ELDER' ? '/dashboard-elder.html' : '/dashboard-monitor.html';
        setTimeout(() => window.location.href = redirect, 1500);
        return null;
    }

    return user;
};

// ─── Format Helpers ───────────────────────────────────────────────────────────
const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
};
const formatTime = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
};
const formatDateTime = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'دلوقتي';
    if (mins < 60) return `منذ ${mins} دقيقة`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `منذ ${hrs} ساعة`;
    return `منذ ${Math.floor(hrs / 24)} يوم`;
};

const reminderTypeLabel = {
    MEDICINE: { label: 'دوا 💊', color: '#EF4444' },
    MEAL: { label: 'أكل 🍽️', color: '#F59E0B' },
    WATER: { label: 'ميه 💧', color: '#0EA5E9' },
    EXERCISE: { label: 'رياضة 🏃', color: '#10B981' },
    APPOINTMENT: { label: 'موعد 📅', color: '#1B5FAD' },
    CUSTOM: { label: 'تذكير 🔔', color: '#2BBFB3' }
};

const alertSeverityLabel = {
    CRITICAL: { label: 'حرج', class: 'alert-critical', color: '#EF4444' },
    HIGH: { label: 'عالي', class: 'alert-high', color: '#F59E0B' },
    MEDIUM: { label: 'متوسط', class: 'alert-medium', color: '#0EA5E9' },
    LOW: { label: 'منخفض', class: 'alert-low', color: '#10B981' }
};
