
'use strict';
const PORTAL_DOMAINS = ['crazygames.com','builds.gamedistribution.com'];
function portalOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      url.origin === origin && PORTAL_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith('.'+domain));
  } catch { return false; }
}
module.exports = { portalOrigin };
