const http = require('http');

async function testApi() {
    // 1. Login as monitor
    const loginData = JSON.stringify({ email: 'monitor@test.com', password: 'password123' });

    // We don't know the exact monitor credentials, but we can query prisma to get one
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const monitors = await prisma.user.findMany({ where: { role: 'MONITOR' } });
    if (!monitors.length) return console.log('No monitors found');
    const monitor = monitors[0];
    const connections = await prisma.connection.findMany({ where: { monitorId: monitor.id, status: 'ACTIVE' } });
    const elderId = connections.length ? connections[0].elderId : monitor.id; // fallback to self if no elder

    // We need a valid token. Let's just sign one manually using jsonwebtoken
    const jwt = require('jsonwebtoken');
    require('dotenv').config();
    const token = jwt.sign({ id: monitor.id, role: monitor.role }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '1d' });

    // 2. Make API call
    const postData = JSON.stringify({
        elderId,
        title: "Test Event API",
        description: "Testing API",
        type: "CUSTOM",
        date: "2026-03-09",
        time: "10:00",
        repeatRule: "ONCE"
    });

    const options = {
        hostname: 'localhost',
        port: 5174,
        path: '/api/calendar',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            console.log('Status:', res.statusCode);
            console.log('Response:', body);
            prisma.$disconnect();
        });
    });

    req.on('error', (e) => {
        console.error('Request Error:', e.message);
        prisma.$disconnect();
    });

    req.write(postData);
    req.end();
}

testApi();
