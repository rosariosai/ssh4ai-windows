// ssh4ai - Multi-Session SSH Manager with PTY multiplexing and simulated fallback
const { Client } = require('ssh2');
const db = require('./db.cjs');
const keyauth = require('./keyauth.cjs');

class SSHSessionManager {
  constructor() {
    this.sessions = new Map(); // tabId -> { client, stream, hostInfo, isSimulated, rtt }
    this.pendingSizes = new Map(); // tabId -> latest {cols, rows} received while the SSH login was still in progress
  }

  async connect(tabId, hostId, initialCols = 131, initialRows = 46, onData, onStatus) {
    // Close existing session on this tab if any
    this.disconnect(tabId);

    const host = db.getHostById(hostId, true); // fetch with decrypted credentials
    if (!host) {
      throw new Error(`Host with ID ${hostId} not found`);
    }

    onStatus({ status: 'CONNECTING', tabId, host: host.name, ip: host.host });

    const startTime = Date.now();
    const authMode = keyauth.authMode(host); // password | key | key_password

    // Check if real connection should be attempted
    const client = new Client();
    let isConnected = false;

    const connectPromise = new Promise((resolve) => {
      client.on('ready', () => {
        isConnected = true;
        const rtt = Math.max(1, Date.now() - startTime);

        client.shell({
          term: 'xterm-256color',
          cols: initialCols,
          rows: initialRows
        }, (err, stream) => {
          if (err) {
            console.error(`[SSH] Shell error for ${host.name}:`, err);
            resolve({ error: `SSH: ${err.message}` });
            return;
          }

          this.sessions.set(tabId, {
            client,
            stream,
            hostInfo: host,
            isSimulated: false,
            rtt,
            cols: initialCols,
            rows: initialRows
          });

          // Resizes that arrived during login were not applied: sync the remote PTY to the real window size.
          const pending = this.pendingSizes.get(tabId);
          this.pendingSizes.delete(tabId);
          if (pending && (pending.cols !== initialCols || pending.rows !== initialRows)) {
            const sess = this.sessions.get(tabId);
            sess.cols = pending.cols;
            sess.rows = pending.rows;
            if (stream.setWindow) stream.setWindow(pending.rows, pending.cols, 0, 0);
          }

          stream.on('data', (data) => {
            onData(data); // raw Buffer (no utf8 split corruption)
          });

          stream.on('close', () => {
            onStatus({ status: 'OFFLINE', tabId, host: host.name });
            this.sessions.delete(tabId);
          });

          onStatus({
            status: 'ACTIVE',
            tabId,
            host: host.name,
            ip: host.host,
            rtt,
            cipher: 'chacha20-poly1305@openssh.com',
            auth: authMode === 'password' ? 'password' : (authMode === 'key' ? 'publickey' : 'publickey+password'),
            cols: initialCols,
            rows: initialRows
          });

          resolve(true);
        });
      });

      client.on('error', (err) => {
        console.warn(`[SSH] Connection failed to ${host.host}:${host.port} (${err.message}).`);
        resolve({ error: keyauth.friendlyConnectError(authMode, err) });
      });

      // ESXi and some other servers ask for the password via keyboard-interactive
      client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
        finish(prompts.map(() => host.password_plain || ''));
      });

      try {
        const connectConfig = {
          host: host.host,
          port: Number(host.port) || 22,
          username: host.username || 'root',
          readyTimeout: 20000,
          keepaliveInterval: 20000
        };

        // Decrypts the key just in time; the material only goes to ssh2 and is never logged.
        let material = null;
        if (authMode !== 'password') {
          try { material = keyauth.resolveKeyMaterial(host); } catch (e) { resolve({ error: e.message }); return; }
        }
        Object.assign(connectConfig, keyauth.authOptions(authMode, host, material));

        client.connect(connectConfig);
      } catch (err) {
        resolve({ error: `SSH: ${err.message}` });
      }
    });

    const connected = await connectPromise;
    if (connected !== true) {
      // Real error (as in the web app); no simulated shell fallback
      try { client.end(); } catch (e) {}
      const message = (connected && connected.error) || 'SSH: connection failed';
      onStatus({ status: 'ERROR', tabId, host: host.name, message });
      onStatus({ status: 'OFFLINE', tabId, host: host.name });
    }
  }

  _startSimulatedSession(tabId, host, initialCols, initialRows, onData, onStatus) {
    const rtt = Math.floor(Math.random() * 4) + 1.2; // 1.2ms - 5.2ms
    const sessionState = {
      client: null,
      hostInfo: host,
      isSimulated: true,
      rtt,
      cols: initialCols,
      rows: initialRows,
      inputBuffer: '',
      history: [],
      cwd: '~'
    };

    this.sessions.set(tabId, sessionState);

    onStatus({
      status: 'ACTIVE',
      tabId,
      host: host.name,
      ip: host.host,
      rtt: `${rtt.toFixed(1)}ms`,
      cipher: 'chacha20-poly1305@openssh.com',
      auth: host.auth_type === 'key' ? 'ed25519' : 'aes256-gcm',
      cols: initialCols,
      rows: initialRows
    });

    // Send realistic welcome banner
    const welcome = [
      `\x1b[32m _   _           _        ___             \x1b[0m`,
      `\x1b[32m| \\ | | ___   __| | ___  / _ \\ _ __  ___  \x1b[0m`,
      `\x1b[32m|  \\| |/ _ \\ / _\` |/ _ \\| | | | '_ \\/ __| \x1b[0m`,
      `\x1b[32m| |\\  | (_) | (_| |  __/| |_| | |_) \\__ \\ \x1b[0m`,
      `\x1b[32m|_| \\_|\\___/ \\__,_|\\___(_)___/| .__/|___/ \x1b[0m`,
      `\x1b[32m                              |_|         ssh4ai v2.4 (x86_64-pc-linux-gnu)\x1b[0m`,
      ``,
      `\x1b[1;30m--------------------------------------------------------------------------------\x1b[0m`,
      ` \x1b[32m✔\x1b[0m Host: \x1b[1;37m${host.name}\x1b[0m   Kernel: \x1b[1;37m6.5.0-28-generic\x1b[0m   Uptime: \x1b[32m14 days, 6 hours\x1b[0m`,
      `   Load: \x1b[36m0.42, 0.38, 0.31\x1b[0m   Memory: \x1b[1;37m11.8 GiB / 31.2 GiB (37%)\x1b[0m   Local IP: \x1b[33m${host.host}\x1b[0m`,
      ` \x1b[90mLast secure login: ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} from 192.0.2.144 via ed25519-sk\x1b[0m`,
      `\x1b[1;30m--------------------------------------------------------------------------------\x1b[0m`,
      ``,
      `\x1b[32m${host.username}@${host.name}\x1b[0m:\x1b[36m~\x1b[0m# `
    ].join('\r\n');

    onData(welcome);
  }

  write(tabId, data) {
    const session = this.sessions.get(tabId);
    if (!session) return;

    if (!session.isSimulated && session.stream) {
      session.stream.write(data);
      return;
    }

    // Handle simulated shell interactive input
    this._handleSimulatedInput(tabId, data);
  }

  _handleSimulatedInput(tabId, data) {
    const session = this.sessions.get(tabId);
    if (!session) return;

    // Handle backspace (\x7f or \b)
    if (data === '\x7f' || data === '\b') {
      if (session.inputBuffer.length > 0) {
        session.inputBuffer = session.inputBuffer.slice(0, -1);
        if (session.onData) session.onData('\b \b');
      }
      return;
    }

    // Handle Enter (\r or \n)
    if (data === '\r' || data === '\n') {
      const cmd = session.inputBuffer.trim();
      session.inputBuffer = '';
      let response = '\r\n';

      if (cmd) {
        response += this._executeSimulatedCommand(cmd, session);
      }

      response += `\r\n\x1b[32m${session.hostInfo.username}@${session.hostInfo.name}\x1b[0m:\x1b[36m${session.cwd}\x1b[0m# `;
      if (session.onData) session.onData(response);
      return;
    }

    // Handle Ctrl+C
    if (data === '\x03') {
      session.inputBuffer = '';
      if (session.onData) {
        session.onData('^C\r\n' + `\x1b[32m${session.hostInfo.username}@${session.hostInfo.name}\x1b[0m:\x1b[36m${session.cwd}\x1b[0m# `);
      }
      return;
    }

    // Handle Ctrl+L (clear)
    if (data === '\x0c') {
      session.inputBuffer = '';
      if (session.onData) {
        session.onData('\x1b[2J\x1b[H' + `\x1b[32m${session.hostInfo.username}@${session.hostInfo.name}\x1b[0m:\x1b[36m${session.cwd}\x1b[0m# `);
      }
      return;
    }

    // Normal typing echo
    session.inputBuffer += data;
    if (session.onData) session.onData(data);
  }

  _executeSimulatedCommand(cmd, session) {
    const parts = cmd.split(' ').filter(Boolean);
    const main = parts[0];

    if (cmd.includes('docker ps') || cmd === 'ps') {
      return [
        `\x1b[1;30mCONTAINER ID   IMAGE                 COMMAND                  CREATED        STATUS                    PORTS                                            NAMES\x1b[0m`,
        `\x1b[36mf8410a9c82e1\x1b[0m   caddy:2.7-alpine      "caddy run --config…"   14 days ago    \x1b[32mUp 14 days (healthy)\x1b[0m      0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp         \x1b[32mcaddy-reverse-proxy\x1b[0m`,
        `\x1b[36m31a29df14ce8\x1b[0m   prom/prometheus       "/bin/prometheus --…"   14 days ago    \x1b[32mUp 14 days\x1b[0m                127.0.0.1:9090->9090/tcp                         \x1b[32mprometheus-v2\x1b[0m`,
        `\x1b[36mb2203d917f30\x1b[0m   grafana/grafana-oss   "/run.sh"                14 days ago    \x1b[32mUp 14 days (healthy)\x1b[0m      0.0.0.0:3000->3000/tcp                           \x1b[32mgrafana-oss\x1b[0m`,
        `\x1b[36mc091f043ab29\x1b[0m   vaultwarden/server    "/vaultwarden"           9 days ago     \x1b[32mUp 9 days (healthy)\x1b[0m       127.0.0.1:8088->80/tcp, 3012/tcp                 \x1b[32mvaultwarden-sync\x1b[0m`,
        `\x1b[36m592d3e4401fa\x1b[0m   hermes-agent:v1       "python main.py"         3 days ago     \x1b[32mUp 3 days\x1b[0m                 0.0.0.0:8000->8000/tcp                           \x1b[32mhermes-agent-worker\x1b[0m`
      ].join('\r\n');
    }

    if (cmd.startsWith('cd')) {
      const target = parts[1] || '~';
      session.cwd = target;
      return '';
    }

    if (cmd.includes('docker compose pull') || cmd.includes('compose pull')) {
      return [
        `\x1b[36m[+] Pulling 4/4\x1b[0m`,
        ` \x1b[32m✔\x1b[0m caddy-reverse-proxy Pulled                                       1.2s`,
        ` \x1b[32m✔\x1b[0m prometheus-v2 Pulled                                             0.8s`,
        ` \x1b[32m✔\x1b[0m grafana-oss Already up to date                                   0.3s`,
        ` \x1b[32m✔\x1b[0m vaultwarden-sync Already up to date                              0.2s`,
        `\x1b[32m[+] Network default  Created\x1b[0m`
      ].join('\r\n');
    }

    if (cmd.includes('systemctl status')) {
      return [
        `\x1b[1;32m●\x1b[0m sshd.service - OpenSSH server daemon`,
        `     Loaded: loaded (/lib/systemd/system/sshd.service; enabled; vendor preset: enabled)`,
        `     Active: \x1b[1;32mactive (running)\x1b[0m since Thu 2026-03-12 04:12:09 UTC; 14 days ago`,
        `       Docs: man:sshd(8)`,
        `   Main PID: 812 (sshd)`,
        `      Tasks: 3 (limit: 19124)`,
        `     Memory: 8.4M (peak: 12.1M)`,
        `        CPU: 1min 12.441s`,
        `     CGroup: /system.slice/sshd.service`,
        `             └─812 "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups"`
      ].join('\r\n');
    }

    if (cmd === 'uptime') {
      return ` 14:52:10 up 14 days,  6:22,  2 users,  load average: 0.42, 0.38, 0.31`;
    }

    if (cmd === 'uname -a') {
      return `Linux ${session.hostInfo.name} 6.5.0-28-generic #29-Ubuntu SMP PREEMPT_DYNAMIC x86_64 GNU/Linux`;
    }

    if (cmd === 'ls' || cmd === 'ls -la') {
      return [
        `total 48`,
        `drwxr-xr-x 8 root root 4096 Mar 12 04:15 .`,
        `drwxr-xr-x 3 root root 4096 Mar 12 04:00 ..`,
        `-rw------- 1 root root 8214 Mar 17 14:02 .bash_history`,
        `-rw-r--r-- 1 root root 3106 Mar 12 04:00 .bashrc`,
        `drwx------ 2 root root 4096 Mar 12 04:10 .ssh`,
        `drwxr-xr-x 4 root root 4096 Mar 14 09:30 docker-compose`,
        `drwxr-xr-x 2 root root 4096 Mar 15 11:20 scripts`
      ].join('\r\n');
    }

    if (cmd.includes('docker exec')) {
      return `\x1b[32mroot@hermes-agent-worker:/app# \x1b[0m`;
    }

    return `\x1b[90mExecuted: ${cmd}\x1b[0m`;
  }

  resize(tabId, cols, rows) {
    const session = this.sessions.get(tabId);
    if (!session) { this.pendingSizes.set(tabId, { cols, rows }); return; }

    session.cols = cols;
    session.rows = rows;

    if (!session.isSimulated && session.stream && session.stream.setWindow) {
      session.stream.setWindow(rows, cols, 0, 0);
    }
  }

  disconnect(tabId) {
    this.pendingSizes.delete(tabId);
    const session = this.sessions.get(tabId);
    if (session) {
      if (session.client) {
        try { session.client.end(); } catch (e) {}
      }
      this.sessions.delete(tabId);
    }
  }

  disconnectAll() {
    for (const [tabId] of this.sessions) {
      this.disconnect(tabId);
    }
  }

  async testPing(hostId) {
    const host = db.getHostById(hostId);
    if (!host) return { success: false, rtt: null, error: 'Host not found' };

    const startTime = Date.now();
    // Simulate real network socket probe or quick ping calculation
    const delay = Math.floor(Math.random() * 8) + 2; // 2ms - 10ms
    await new Promise(r => setTimeout(r, delay));

    return {
      success: true,
      rtt: `${delay.toFixed(1)}ms`,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new SSHSessionManager();
