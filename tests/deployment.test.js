'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

test('production server respects PORT, serves client and restricts remote handshakes', async t => {
  // Reservar un puerto local libre para probar un servidor real, sin mocks HTTP.
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', CLIENT_ORIGINS: 'https://fleet.example' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Server startup timed out')), 10000);
    let output = '';
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); reject(Error(`Server exited: ${code}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('Servidor Listo')) { clearTimeout(timeout); resolve(); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(health.headers.get('x-powered-by'), null);
  const html = await (await fetch(base)).text();
  assert.match(html,/<script src="config\.js(?:\?[^"]*)?"><\/script>/);
  const config = await fetch(`${base}/config.js`);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.ok((await config.text()).includes('backendUrl'));
  const endpoint = `${base}/socket.io/?EIO=4&transport=polling`;
  const allowed = await fetch(endpoint, { headers: { Origin: 'https://fleet.example' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://fleet.example');
  assert.ok((await allowed.text()).startsWith('0{"sid":'));
  for (const origin of ['https://fleet-io-d45d5.web.app', 'https://fleet-io-d45d5.firebaseapp.com']) {
    const publishedClient = await fetch(endpoint, { headers: { Origin: origin } });
    assert.equal(publishedClient.status, 200);
    assert.equal(publishedClient.headers.get('access-control-allow-origin'), origin);
  }
  const rejected = await fetch(endpoint, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(rejected.status, 403);
  const sameOrigin = await fetch(endpoint, { headers: { Origin: base } });
  assert.equal(sameOrigin.status, 200);
});
