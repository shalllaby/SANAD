// Quick API test script
const http = require('http');

function apiCall(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : '';
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (body) headers['Content-Length'] = Buffer.byteLength(data);
        const opts = { hostname: 'localhost', port: 5174, path, method, headers };
        const req = http.request(opts, (res) => {
            let result = '';
            res.on('data', (d) => result += d);
            res.on('end', () => { try { resolve(JSON.parse(result)); } catch (e) { resolve(result); } });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function test() {
    console.log('=== SANAD API Test ===\n');

    const ping = await apiCall('GET', '/api/ping');
    console.log('1. Ping:', ping.status === 'ok' ? 'OK' : 'FAIL');

    const monitor = await apiCall('POST', '/api/auth/register', { name: 'Test Monitor', email: `m${Date.now()}@t.com`, password: 'test123', role: 'MONITOR' });
    console.log('2. Register Monitor:', monitor.token ? 'OK' : monitor.error);

    const elder = await apiCall('POST', '/api/auth/register', { name: 'Test Elder', email: `e${Date.now()}@t.com`, password: 'test123', role: 'ELDER' });
    console.log('3. Register Elder:', elder.token ? 'OK' : elder.error);

    if (!monitor.token || !elder.token) return;

    const loc = await apiCall('POST', '/api/location/update', { latitude: 30.0444, longitude: 31.2357, accuracy: 10 }, elder.token);
    console.log('4. Location Update:', loc.location ? 'OK' : (loc.error || 'FAIL'));

    const em = await apiCall('POST', '/api/alerts/emergency', { latitude: 30.0444, longitude: 31.2357 }, elder.token);
    console.log('5. Emergency Alert:', em.alert ? 'OK' : (em.error || 'FAIL'));

    const unread = await apiCall('GET', '/api/messages/unread-count', null, elder.token);
    console.log('6. Unread Messages:', unread.unreadCount != null ? 'OK' : (unread.error || 'FAIL'));

    const events = await apiCall('GET', '/api/calendar/my-events', null, elder.token);
    console.log('7. My Calendar Events:', events.events ? 'OK' : (events.error || 'FAIL'));

    console.log('\n=== All endpoints responding ===');
}
test().catch(console.error);
