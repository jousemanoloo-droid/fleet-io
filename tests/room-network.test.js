'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

// Cliente de prueba del protocolo Engine.IO/Socket.IO por WebSocket nativo.
// No se necesita añadir una dependencia de ejecución para las pruebas.
class RoomClient {
  constructor(url) {
    this.events = [];
    this.waiters = [];
    this.acks = new Map();
    this.sequence = 0;
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onerror = reject;
      this.ws.onmessage = event => {
        const packet = String(event.data);
        if (packet.startsWith('0')) this.ws.send('40');
        else if (packet === '2') this.ws.send('3');
        else if (packet.startsWith('40')) resolve();
        else if (packet.startsWith('42')) {
          const [name, data] = JSON.parse(packet.slice(2));
          this.events.push({ name, data });
          for (const waiter of [...this.waiters]) {
            if (waiter.predicate({ name, data })) {
              this.waiters.splice(this.waiters.indexOf(waiter), 1);
              clearTimeout(waiter.timer); waiter.resolve(data);
            }
          }
        } else if (packet.startsWith('43')) {
          const match = /^43(\d+)(\[.*)$/.exec(packet);
          const ack = this.acks.get(Number(match[1]));
          if (ack) {
            this.acks.delete(Number(match[1])); clearTimeout(ack.timer);
            ack.resolve(JSON.parse(match[2])[0]);
          }
        }
      };
    });
  }
  emit(name, data) {
    const id = this.sequence++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`No ack for ${name}`)), 5000);
      this.acks.set(id, { resolve, timer });
      this.ws.send(`42${id}${JSON.stringify([name, data])}`);
    });
  }
  waitFor(predicate) {
    const cached = this.events.find(predicate);
    if (cached) return Promise.resolve(cached.data);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: setTimeout(() => reject(Error('Event timeout')), 5000) };
      this.waiters.push(waiter);
    });
  }
  close() {
    for (const ack of this.acks.values()) clearTimeout(ack.timer);
    for (const waiter of this.waiters) clearTimeout(waiter.timer);
    this.ws.close();
  }
}

test('real WebSocket clients join isolated public/private/solo rooms and transfer safely', async t => {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = [];
  t.after(() => { for (const client of clients) client.close(); child.kill(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Startup timeout')), 10000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', data => {
      if (String(data).includes('Servidor Listo')) { clearTimeout(timer); resolve(); }
    });
  });
  for (let i = 0; i < 4; i++) {
    const client = new RoomClient(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    clients.push(client);
    await client.ready;
  }
  const [creator, friend, solo, publicPlayer] = clients;
  const privateResult = await creator.emit('createPrivateRoom', { name: 'Creator' });
  assert.equal(privateResult.ok, true);
  assert.match(privateResult.roomCode, /^[A-Z2-9]{6}$/);
  const friendResult = await friend.emit('joinRoom', { name: 'Friend', roomCode: privateResult.roomCode });
  assert.equal(friendResult.room.roomId, privateResult.room.roomId);
  const soloResult = await solo.emit('startSinglePlayer', { name: 'Solo' });
  const publicResult = await publicPlayer.emit('joinRoom', { name: 'Public', roomCode: 'public' });
  assert.equal(soloResult.room.bots, 7);
  const shared = await creator.waitFor(event => event.name === 'gameState' && event.data.p.length === 2);
  assert.deepEqual(shared.p.map(p => p.name).sort(), ['Creator', 'Friend']);
  const isolated = await solo.waitFor(event => event.name === 'gameState');
  assert.equal(isolated.p.filter(p => p.isBot).length, 7);
  assert.equal(isolated.p.some(p => p.name === 'Creator'), false);
  const publicState = await publicPlayer.waitFor(event => event.name === 'gameState');
  assert.equal(publicState.p.length, 1);
  assert.equal(publicState.roomId, publicResult.room.roomId);
  await new Promise(resolve => setTimeout(resolve, 1100));
  const invalid = await friend.emit('joinRoom', { roomCode: '!!!!!!' });
  assert.equal(invalid.ok, false);
  await new Promise(resolve => setTimeout(resolve, 1100));
  const transferred = await friend.emit('joinRoom', { roomCode: 'public' });
  assert.equal(transferred.room.roomId, publicResult.room.roomId);
  const updated = await publicPlayer.waitFor(event => event.name === 'gameState' && event.data.p.length === 2);
  assert.deepEqual(updated.p.map(p => p.name).sort(), ['Friend', 'Public']);
  assert.ok(!friend.events.some(event => event.name === 'gameState' && event.data.roomId === soloResult.room.roomId));
});
