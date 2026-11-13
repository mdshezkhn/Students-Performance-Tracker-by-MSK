import { createApp } from './server/spr-server.mjs';
const srv = await createApp({ cookieSecure: false });
srv.on('request', (req) => console.log('SRV SEEN:', req.method, req.url));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'spr-admin-change-me' }) });
console.log('status', res.status, await res.text());
