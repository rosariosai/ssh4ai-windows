// ssh4ai - bridge that serves the web app's REST API (/api/*) from the local database.
// The renderer (web UI) calls api-request over IPC; sessions are streamed via ssh-attach.
const crypto = require('node:crypto');
const db = require('./db.cjs');
const keyauth = require('./keyauth.cjs');
const sshManager = require('./ssh-manager.cjs');

const sessions = new Map(); // sessionId -> { hostId, label, host, username }

function toDevice(h) {
  return {
    id: h.id,
    device_name: h.name,
    name: h.name,
    ip_address: h.host,
    host: h.host,
    username: h.username,
    port: h.port,
    pinned: h.is_pinned ? 1 : 0,
    sort_order: h.sort_order,
    auth_type: keyauth.authMode(h),
    has_key: !!h.has_key, // never private_key / key_passphrase
    public_key: h.public_key || null
  };
}

const ok = (body, status = 200) => ({ status, body });
const err = (status, message) => ({ status, body: { error: message } });

function handle(method, rawPath, body) {
  const path = String(rawPath).split('?')[0].replace(/\/+$/, '');
  body = body || {};
  let m;

  // ---- Devices ----
  if (path === '/api/devices' && method === 'GET') return ok(db.getHosts().map(toDevice));
  if (path === '/api/devices' && method === 'POST') {
    const auth_type = body.auth_type || 'password';
    if (!keyauth.AUTH_TYPES.includes(auth_type)) return err(400, 'Invalid auth_type');
    if (!body.device_name || !body.ip_address || !body.username || (auth_type !== 'key' && !body.password)) {
      return err(400, auth_type === 'key'
        ? 'device_name, ip_address and username are required'
        : 'device_name, ip_address, username and password are required');
    }
    if (auth_type !== 'password' && !keyauth.isAvailable()) return err(503, keyauth.UNAVAILABLE_MSG);
    let kp = null;
    try { kp = keyauth.keyFromBody(body, body.device_name); } catch (e) { return err(e.status || 400, e.message); }
    const h = db.saveHost({ name: body.device_name, host: body.ip_address, username: body.username, password: body.password || '', port: body.port,
      auth_type, ...(kp ? { private_key: kp.priv, key_passphrase: kp.pass, public_key: kp.pub } : {}) });
    return ok({ id: h.id }, 201);
  }
  if (path === '/api/devices/reorder' && method === 'PUT') {
    return ok({ ok: db.reorderHosts(body.order || body.ids || []) });
  }
  if ((m = path.match(/^\/api\/devices\/([^/]+)\/pin$/)) && method === 'PUT') {
    const host = db.getHostById(m[1]);
    if (!host) return err(404, 'Not found');
    const want = body.pinned ? 1 : 0;
    if ((host.is_pinned ? 1 : 0) !== want) db.togglePin(m[1]);
    return ok({ ok: true });
  }
  // Generate an ed25519 key pair; the private key is stored encrypted, only the public key is returned.
  if ((m = path.match(/^\/api\/devices\/([^/]+)\/generate-key$/)) && method === 'POST') {
    if (!keyauth.isAvailable()) return err(503, keyauth.UNAVAILABLE_MSG);
    const h = db.getHostById(m[1]);
    if (!h) return err(404, 'Not found');
    if (h.has_key && body.replace !== true) {
      return err(409, 'Host already has a private key; send {"replace":true} to overwrite it');
    }
    const kp = keyauth.generateKeyPair(h.name);
    const newAuth = keyauth.authMode(h) === 'password' ? 'key' : keyauth.authMode(h);
    db.saveHost({ id: h.id, auth_type: newAuth, private_key: kp.priv, key_passphrase: null, public_key: kp.pub });
    return ok({ public_key: kp.pub, auth_type: newAuth });
  }
  // Public key of a host (derived from the stored private key if it was not saved yet).
  if ((m = path.match(/^\/api\/devices\/([^/]+)\/public-key$/)) && method === 'GET') {
    const raw = db.getHostById(m[1], true);
    if (!raw || (!raw.private_key && !raw.public_key)) return err(404, 'No key stored for this host');
    if (raw.public_key) return ok({ public_key: raw.public_key });
    try {
      const pub = keyauth.derivePublicKey(raw, raw.name);
      db.saveHost({ id: raw.id, public_key: pub });
      return ok({ public_key: pub });
    } catch (e) { return err(500, e.message); }
  }
  if ((m = path.match(/^\/api\/devices\/([^/]+)$/))) {
    const id = m[1];
    if (method === 'GET') {
      const h = db.getHostById(id);
      return h ? ok(toDevice(h)) : err(404, 'Not found');
    }
    if (method === 'PUT') {
      const cur = db.getHostById(id);
      if (!cur) return err(404, 'Not found');
      const auth_type = body.auth_type || 'password';
      if (!keyauth.AUTH_TYPES.includes(auth_type)) return err(400, 'Invalid auth_type');
      if (auth_type !== 'password' && !keyauth.isAvailable()) return err(503, keyauth.UNAVAILABLE_MSG);
      let kp = null; // empty private_key keeps the stored key; a wrong passphrase is rejected here, nothing is stored
      try { kp = keyauth.keyFromBody(body, body.device_name || cur.name); } catch (e) { return err(e.status || 400, e.message); }
      // empty password keeps the stored one (db.saveHost ignores '')
      db.saveHost({ id, name: body.device_name, host: body.ip_address, username: body.username, password: body.password, port: body.port,
        auth_type, ...(kp ? { private_key: kp.priv, key_passphrase: kp.pass, public_key: kp.pub } : {}) });
      return ok({ ok: true });
    }
    if (method === 'DELETE') { db.deleteHost(id); return ok({ ok: true }); }
  }

  // ---- Macros (web id = key slot) ----
  if (path === '/api/macros' && method === 'GET') {
    return ok(db.getMacros().map((x) => ({ id: x.key_slot, name: x.name, command: x.command })));
  }
  if ((m = path.match(/^\/api\/macros\/(\d+)$/)) && method === 'PUT') {
    const slot = Number(m[1]);
    const cur = db.getMacros().find((x) => x.key_slot === slot);
    db.saveMacro({ key_slot: slot, name: body.name || '', command: body.command || '',
      tag_color: cur && cur.tag_color, auto_enter: cur ? cur.auto_enter : 1 });
    return ok({ ok: true });
  }

  // ---- Buckets (the web UI keeps these in localStorage; endpoints kept for parity) ----
  if (path === '/api/buckets' && method === 'GET') {
    return ok(db.getScratchpads().map((b) => ({ id: b.bucket_index, content: b.content })));
  }
  if ((m = path.match(/^\/api\/buckets\/(\d+)$/)) && method === 'PUT') {
    db.saveScratchpad(Number(m[1]), null, body.content || '');
    return ok({ ok: true });
  }

  // ---- Web Links ----
  if (path === '/api/links' && method === 'GET') return ok(db.getLinks());
  if ((m = path.match(/^\/api\/links\/(\d+)$/)) && method === 'PUT') {
    const name = String(body.name || '').trim().slice(0, 60);
    const url = String(body.url || '').trim();
    const icon = body.icon ? String(body.icon) : null;
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return err(400, 'URL must start with http:// or https://');
    if (url.length > 1000) return err(400, 'URL too long');
    if (icon && (!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(icon) || icon.length > 200000)) {
      return err(400, 'Invalid icon image');
    }
    db.saveLink(m[1], name, url, icon);
    return ok({ ok: true });
  }

  // ---- Sessions ----
  if ((m = path.match(/^\/api\/connect\/([^/]+)$/)) && method === 'POST') {
    const h = db.getHostById(m[1], true); // decrypted credentials stay inside this function
    if (!h) return err(404, 'Device not found');
    if (keyauth.authMode(h) !== 'password') {
      try { keyauth.resolveKeyMaterial(h); } catch (e) { return err(400, e.message); }
    }
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { hostId: h.id });
    return ok({ sessionId, label: h.name, host: h.host, username: h.username });
  }
  if ((m = path.match(/^\/api\/sessions\/([^/]+)$/)) && method === 'DELETE') {
    if (!sessions.has(m[1])) return err(404, 'Session not found');
    sshManager.disconnect(m[1]);
    sessions.delete(m[1]);
    return ok({ ok: true });
  }

  return err(404, `No route: ${method} ${path}`);
}

// Start the SSH stream for a session created by POST /api/connect/:id
async function attach(sessionId, cols, rows, send) {
  const s = sessions.get(sessionId);
  if (!s) { send('status', { tabId: sessionId, status: 'ERROR', message: 'Session not found' }); return; }
  try {
    await sshManager.connect(
      sessionId, s.hostId, cols || 120, rows || 30,
      (data) => send('data', { tabId: sessionId, data: Buffer.from(data).toString('base64') }),
      (status) => send('status', { ...status, tabId: sessionId })
    );
  } catch (e) {
    send('status', { tabId: sessionId, status: 'ERROR', message: e.message });
  }
}

function closeSession(sessionId) { sessions.delete(sessionId); }

module.exports = { handle, attach, closeSession };
