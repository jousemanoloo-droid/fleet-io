'use strict';
// Catch at the message boundary, not around the simulation: malformed inputs
// must never abort a tick or retain an unbounded queue of pending work.
function register(socket, logger = console, now = Date.now) {
  let windowAt = now(), count = 0;
  return (event, handler) => socket.on(event, (...args) => {
    const ack = typeof args.at(-1) === 'function' ? args.at(-1) : null;
    const fail = () => { try { ack?.({ok:false,error:'error.invalidRequest'}); } catch {} };
    if (event !== 'disconnect') {
      const time = now();
      if (time - windowAt >= 1000) { windowAt = time; count = 0; }
      if (++count > 180) { fail(); return; }
      const data = args[0];
      if (data !== undefined && data !== null && (typeof data !== 'object' || Array.isArray(data))) { fail(); return; }
    }
    try {
      const result = handler(...args);
      if (result?.catch) result.catch(() => fail());
    } catch {
      // Do not log payloads, credentials or flood logs for hostile clients.
      fail();
    }
  });
}
module.exports = {register};
