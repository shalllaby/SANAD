require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5174;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Serve Static Frontend ────────────────────────────────────────────────────
const clientPath = path.join(__dirname, '../../client');
app.use(express.static(clientPath));

// ─── API Routes ───────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const connectionRoutes = require('./routes/connections');
const reminderRoutes = require('./routes/reminders');
const alertRoutes = require('./routes/alerts');
const chatRoutes = require('./routes/chat');
const integrationRoutes = require('./routes/integrations');
const healthRoutes = require('./routes/health');
const messageRoutes = require('./routes/direct-messages');
const calendarRoutes = require('./routes/calendar');
const locationRoutes = require('./routes/location');


app.use('/api/auth', authRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/location', locationRoutes);


// ─── Connection page SPA route ────────────────────────────────────────────────
app.get('/connect/:code', (req, res) => {
  res.sendFile(path.join(clientPath, 'connect.html'));
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', message: 'Elderly Care Platform API is running', timestamp: new Date().toISOString() });
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Route not found' });
  }
  res.sendFile(path.join(clientPath, 'index.html'));
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ error: 'Internal server error', message: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌙 نظام رعاية كبار السن — يعمل على http://localhost:${PORT}`);
  console.log(`📊 واجهة البرنامج: http://localhost:${PORT}`);
  console.log(`🔌 API: http://localhost:${PORT}/api`);

  // Start reminder cron job
  require('./jobs/reminderJob');
});
