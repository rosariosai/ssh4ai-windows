// ssh4ai (Electron) - lets the unmodified web UI (web-app.js) run offline.
// /api/* fetches and the /ws WebSocket are routed over IPC to the main process.
(function () {
  'use strict';
  const api = window.nodeOpsApi;
  if (!api) return;

  // ---- fetch('/api/...') -> IPC ------------------------------------------
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const m = url.match(/^(?:file:\/\/[^/]*)?(\/api\/.*)$/);
    if (!m) return nativeFetch(input, init);
    const method = ((init && init.method) || 'GET').toUpperCase();
    let body;
    if (init && init.body) { try { body = JSON.parse(init.body); } catch (e) { body = undefined; } }
    const r = await api.apiRequest(method, m[1], body);
    return new Response(JSON.stringify(r.body === undefined ? {} : r.body), {
      status: r.status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  // ---- WebSocket('/ws') -> IPC -------------------------------------------
  const NativeWS = window.WebSocket;
  const sockets = new Map(); // sessionId -> FakeWS

  class FakeWS extends EventTarget {
    constructor() {
      super();
      this.readyState = 0;
      this.sessionId = null;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      setTimeout(() => { this.readyState = 1; this._emit('open', new Event('open')); }, 0);
    }
    _emit(type, evt) {
      const h = this['on' + type];
      if (typeof h === 'function') h.call(this, evt);
      this.dispatchEvent(evt);
    }
    _message(data) { this._emit('message', new MessageEvent('message', { data })); }
    send(raw) {
      let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg.type === 'attach') {
        this.sessionId = msg.sessionId;
        sockets.set(this.sessionId, this);
        api.sshAttach(msg.sessionId, msg.cols, msg.rows);
      } else if (msg.type === 'input' && this.sessionId) api.sshWrite(this.sessionId, msg.data);
      else if (msg.type === 'resize' && this.sessionId) api.sshResize(this.sessionId, msg.cols, msg.rows);
    }
    close() {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      if (this.sessionId) { api.sshDisconnect(this.sessionId); sockets.delete(this.sessionId); }
      this._emit('close', new Event('close'));
    }
  }
  FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;

  window.WebSocket = function (url, protocols) {
    if (typeof url === 'string' && /\/ws$/.test(url)) return new FakeWS();
    return new NativeWS(url, protocols);
  };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

  api.onSSHData(({ tabId, data }) => {
    const ws = sockets.get(tabId);
    if (ws) ws._message('O' + data); // data is base64
  });
  api.onSSHStatus((p) => {
    const ws = sockets.get(p.tabId);
    if (!ws) return;
    if (p.status === 'ACTIVE') ws._message(JSON.stringify({ type: 'status', data: 'connected' }));
    else if (p.status === 'ERROR') ws._message(JSON.stringify({ type: 'error', data: p.message || 'Connection failed' }));
    else if (p.status === 'OFFLINE') ws._message(JSON.stringify({ type: 'status', data: 'disconnected' }));
  });

  // ---- clipboard via main process (reliable on file://) ------------------
  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t) => api.copyToClipboard(String(t)).then(() => undefined),
        readText: () => api.readClipboard()
      }
    });
  } catch (e) { /* keep native clipboard */ }

  // ---- window controls + Zen fullscreen ----------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    if ($('win-min')) $('win-min').addEventListener('click', () => api.minimize());
    if ($('win-max')) $('win-max').addEventListener('click', () => api.maximize());
    if ($('win-close')) $('win-close').addEventListener('click', () => api.close());
    const icon = $('win-max-icon');
    const setIcon = (isMax) => { if (icon) icon.textContent = isMax ? 'filter_none' : 'crop_square'; };
    api.isMaximized().then(setIcon);
    api.onMaximizeChange(setIcon);
    // Zen mode (body.zen-active) also toggles real fullscreen
    let fs = false;
    new MutationObserver(() => {
      const z = document.body.classList.contains('zen-active');
      if (z !== fs) { fs = z; api.setFullscreen(z); }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  });
})();
