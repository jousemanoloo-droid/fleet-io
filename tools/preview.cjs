// Vista previa local aislada: mantiene intacta la URL de producción de config.js.
'use strict';
const express = require('express');
const path = require('node:path');
const { spawn } = require('node:child_process');
const port = Number(process.env.PREVIEW_PORT || 3013);
const backendPort = port + 1;
const backendArgs = process.argv.includes('--hazards')
  ? ['--require', './tools/hazard-preview.cjs', 'server/server.js'] : process.argv.includes('--pvp')
  ? ['--require', './tools/pvp-preview.cjs', 'server/server.js'] : process.argv.includes('--events')
  ? ['--require', './tools/event-preview.cjs', 'server/server.js'] : ['server/server.js'];
const backend = spawn(process.execPath, backendArgs, {
  cwd: path.join(__dirname, '..'), stdio: 'inherit',
  env: { ...process.env, PORT: String(backendPort), NODE_ENV: 'development',
    CLIENT_ORIGINS: `http://localhost:${port},http://127.0.0.1:${port}` },
});
const app = express();
app.get('/config.js', (_req, res) => res.type('js').send(
  `window.FLEET_CONFIG = Object.freeze({backendUrl:'http://127.0.0.1:${backendPort}'});`));
app.use(express.static(path.join(__dirname, '../client')));
const server = app.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}/?debug=1`));
const stop = () => { backend.kill(); server.close(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
backend.on('error', error => { console.error(error); stop(); });
