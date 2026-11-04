// ssh4ai - SQLite Database Engine using sql.js (WebAssembly SQLite)
const initSqlJs = require('sql.js');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vault = require('./vault.cjs');
const keyauth = require('./keyauth.cjs');

class DatabaseEngine {
  constructor() {
    this.dbDir = path.join(os.homedir(), '.nodeops');
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
    }
    this.dbPath = path.join(this.dbDir, 'nodeops.db');
    this.db = null;
    this.SQL = null;
    this._initPromise = null;
  }

  async init() {
    if (this.db) return this;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      this.SQL = await initSqlJs();

      if (fs.existsSync(this.dbPath)) {
        try {
          const fileBuffer = fs.readFileSync(this.dbPath);
          this.db = new this.SQL.Database(fileBuffer);
        } catch (err) {
          console.warn('[DB] Failed to load existing database file, creating fresh one:', err);
          this.db = new this.SQL.Database();
        }
      } else {
        this.db = new this.SQL.Database();
      }

      this._createTables();
      this._migrateKeyAuth();
      this._seedDefaults();
      this._saveToDisk();
      return this;
    })();

    return this._initPromise;
  }

  _saveToDisk() {
    try {
      if (!this.db) return;
      const data = this.db.export();
      const buffer = Buffer.from(data);
      const tmpPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, this.dbPath);
    } catch (err) {
      console.error('[DB] Error persisting to disk:', err);
    }
  }

  _createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        group_name TEXT DEFAULT 'Default',
        host TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        username TEXT NOT NULL,
        password_encrypted TEXT,
        auth_type TEXT DEFAULT 'password',
        private_key TEXT,
        is_pinned INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS macros (
        id TEXT PRIMARY KEY,
        key_slot INTEGER UNIQUE NOT NULL,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        tag_color TEXT DEFAULT 'terminal-cyan',
        auto_enter INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS scratchpad (
        id TEXT PRIMARY KEY,
        bucket_index INTEGER UNIQUE NOT NULL,
        title TEXT NOT NULL,
        content TEXT DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        icon TEXT
      );
    `);
  }

  // v3.1.0 key authentication. Idempotent: runs on every start, only adds what is missing.
  // `hosts` already has auth_type and private_key from older versions; key_passphrase and public_key are new.
  // sql.js has no ADD COLUMN IF NOT EXISTS, so PRAGMA table_info is checked first. The database file is
  // copied before the first change, and the changes run in one transaction (rolled back on error).
  _migrateKeyAuth() {
    const info = this.db.exec('PRAGMA table_info(hosts)');
    const have = new Set(info.length ? info[0].values.map((r) => r[1]) : []);
    const wanted = [
      ['auth_type', "TEXT DEFAULT 'password'"],
      ['private_key', 'TEXT'],
      ['key_passphrase', 'TEXT'],
      ['public_key', 'TEXT']
    ];
    const missing = wanted.filter(([name]) => !have.has(name));
    if (missing.length && fs.existsSync(this.dbPath)) {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const backup = `${this.dbPath}.bak-pre-keyauth-${stamp}`;
      if (!fs.existsSync(backup)) fs.copyFileSync(this.dbPath, backup);
      console.log('[DB] Backed up database before key-auth migration');
    }
    if (missing.length) {
      this.db.run('BEGIN');
      try {
        for (const [name, type] of missing) this.db.run(`ALTER TABLE hosts ADD COLUMN ${name} ${type}`);
        this.db.run("UPDATE hosts SET auth_type = 'password' WHERE auth_type IS NULL OR auth_type = ''");
        this.db.run('COMMIT');
      } catch (err) {
        try { this.db.run('ROLLBACK'); } catch (e) {}
        throw new Error(`Key-auth database migration failed (database left unchanged): ${err.message}`);
      }
      console.log(`[DB] Key-auth columns added: ${missing.map((m) => m[0]).join(', ')}`);
    }

    // A private key left in plaintext by an older version is encrypted in place (never logged).
    if (keyauth.isAvailable()) {
      const res = this.db.exec("SELECT id, private_key FROM hosts WHERE private_key IS NOT NULL AND private_key <> ''");
      const rows = (res.length ? res[0].values : []).filter(([, pk]) => !keyauth.isEncrypted(pk));
      if (rows.length) {
        // secure_delete zeroes the old bytes and VACUUM rewrites the file, so no plaintext remnant stays in free pages
        this.db.run('PRAGMA secure_delete = ON');
        for (const [id, pk] of rows) this.db.run('UPDATE hosts SET private_key = ? WHERE id = ?', [keyauth.encryptSecret(pk), id]);
        this.db.run('VACUUM');
        console.log(`[DB] Encrypted ${rows.length} legacy plaintext private key(s)`);
      }
    }
  }

  _seedDefaults() {
    // Web Links: 4 launcher slots, slot 1 = Presidio (same as the web app)
    const linkCountRes = this.db.exec('SELECT COUNT(*) AS count FROM links');
    const linkCount = linkCountRes.length > 0 ? linkCountRes[0].values[0][0] : 0;
    if (linkCount === 0) {
      this.db.run('INSERT INTO links (id, name, url, icon) VALUES (1, ?, ?, NULL);', ['Presidio', 'https://example.com/']);
      for (let i = 2; i <= 4; i++) this.db.run('INSERT INTO links (id, name, url, icon) VALUES (?, \'\', \'\', NULL);', [i]);
    }

    // Check hosts count
    const hostCountRes = this.db.exec('SELECT COUNT(*) AS count FROM hosts');
    const hostCount = hostCountRes.length > 0 ? hostCountRes[0].values[0][0] : 0;

    if (hostCount === 0) {
      const now = new Date().toISOString();
      const insertHostSql = `
        INSERT INTO hosts (id, name, group_name, host, port, username, password_encrypted, auth_type, is_pinned, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `;

      this.db.run(insertHostSql, [
        'host-1',
        'prod-gateway-01',
        'Production Homelab',
        '192.0.2.4',
        22,
        'root',
        vault.encrypt('SuperSecureGatewayPass!'),
        'password',
        1,
        1,
        now,
        now
      ]);

      this.db.run(insertHostSql, [
        'host-2',
        'ZC1-EdgeCore',
        'Core Infrastructure',
        '198.51.100.1',
        2222,
        'admin',
        vault.encrypt('EdgeCorePass2026'),
        'password',
        0,
        2,
        now,
        now
      ]);

      this.db.run(insertHostSql, [
        'host-3',
        'ha-supervisor',
        'IoT & Smart Home',
        '192.0.2.15',
        22,
        'hassio',
        vault.encrypt('HomeAssistantSuperUser'),
        'password',
        1,
        3,
        now,
        now
      ]);
    }

    // Check macros
    const macroCountRes = this.db.exec('SELECT COUNT(*) AS count FROM macros');
    const macroCount = macroCountRes.length > 0 ? macroCountRes[0].values[0][0] : 0;

    if (macroCount === 0) {
      const insertMacroSql = `
        INSERT INTO macros (id, key_slot, name, command, tag_color, auto_enter, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `;

      this.db.run(insertMacroSql, ['m1', 1, 'ps', 'docker ps | grep hermes', 'terminal-cyan', 1, 1]);
      this.db.run(insertMacroSql, ['m2', 2, 'compose', 'cd /var/lib/casaos/apps && docker compose pull', 'terminal-cyan', 1, 2]);
      this.db.run(insertMacroSql, ['m3', 3, 'cd', 'cd /etc/systemd/system', 'terminal-amber', 1, 3]);
      this.db.run(insertMacroSql, ['m4', 4, 'cs ssh', 'cd /media/Raid1SS0/AppData/webssh', 'terminal-amber', 1, 4]);
      this.db.run(insertMacroSql, ['m5', 5, 'bash', 'docker exec -it hermes bash', 'terminal-emerald', 1, 5]);
    }

    // Check scratchpad
    const padCountRes = this.db.exec('SELECT COUNT(*) AS count FROM scratchpad');
    const padCount = padCountRes.length > 0 ? padCountRes[0].values[0][0] : 0;

    if (padCount === 0) {
      const now = new Date().toISOString();
      const insertPadSql = `
        INSERT INTO scratchpad (id, bucket_index, title, content, updated_at)
        VALUES (?, ?, ?, ?, ?);
      `;

      this.db.run(insertPadSql, ['b1', 1, 'Deployment Notes', '# Deployment Checklist\n- docker compose up -d\n- check nginx reverse proxy certs\n- verify ufw status', now]);
      this.db.run(insertPadSql, ['b2', 2, 'VM IDs', '101: Example VM 1\n102: Example VM 2\n103: Example VM 3', now]);
      this.db.run(insertPadSql, ['b3', 3, 'Network & DNS', 'Subnets:\n- Example subnet: 192.0.2.0/24', now]);
      this.db.run(insertPadSql, ['b4', 4, 'Cloudflare / Tunnels', 'Tunnel ID: cf-tunnel-homelab-prod\nGateway: caddy.internal.lan:8443', now]);
      this.db.run(insertPadSql, ['b5', 5, 'Quick Snippets', 'systemctl list-unit-files --state=failed\njournalctl -u ssh -n 50 --no-pager', now]);
    }

    // Default settings
    const defaultSettings = {
      'terminal.bgColor': '#0a0e14',
      'terminal.fgColor': '#10b981',
      'terminal.cursorColor': '#34d399',
      'terminal.cursorStyle': 'block',
      'terminal.fontFamily': 'Cascadia Code PL, JetBrains Mono, monospace',
      'terminal.fontSize': '13',
      'view.compactSidebar': 'false',
      'storage.type': 'sqlite',
      'storage.logDirectory': path.join(this.dbDir, 'logs')
    };

    for (const [k, v] of Object.entries(defaultSettings)) {
      const existing = this.db.exec(`SELECT value FROM settings WHERE key = '${k}'`);
      if (existing.length === 0 || existing[0].values.length === 0) {
        this.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [k, v]);
      }
    }
  }

  // --- HOST OPERATIONS ---
  getHosts() {
    const stmt = this.db.prepare('SELECT * FROM hosts ORDER BY sort_order ASC, created_at ASC');
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();

    return rows.map(r => ({
      ...r,
      has_password: Boolean(r.password_encrypted && r.password_encrypted.length > 0),
      has_key: Boolean(r.private_key && r.private_key.length > 0),
      password_encrypted: undefined,
      private_key: undefined,
      key_passphrase: undefined
    }));
  }

  getHostById(id, withSecret = false) {
    const stmt = this.db.prepare('SELECT * FROM hosts WHERE id = ?');
    stmt.bind([id]);
    let row = null;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();

    if (!row) return null;
    if (withSecret) {
      return {
        ...row,
        password_plain: vault.decrypt(row.password_encrypted)
      };
    }
    return {
      ...row,
      has_password: Boolean(row.password_encrypted && row.password_encrypted.length > 0),
      has_key: Boolean(row.private_key && row.private_key.length > 0),
      password_encrypted: undefined,
      private_key: undefined,
      key_passphrase: undefined
    };
  }

  saveHost(hostData) {
    const now = new Date().toISOString();
    const id = hostData.id || `host-${crypto.randomUUID().slice(0, 8)}`;

    const existing = this.getHostById(id, true);

    let passwordEncrypted = existing ? (this.db.exec(`SELECT password_encrypted FROM hosts WHERE id = '${id}'`)[0]?.values[0]?.[0] || '') : '';
    if (hostData.password !== undefined && hostData.password !== '') {
      passwordEncrypted = vault.encrypt(hostData.password);
    }

    if (existing) {
      const sql = `
        UPDATE hosts SET
          name = ?,
          group_name = ?,
          host = ?,
          port = ?,
          username = ?,
          password_encrypted = ?,
          auth_type = ?,
          private_key = ?,
          key_passphrase = ?,
          public_key = ?,
          is_pinned = ?,
          updated_at = ?
        WHERE id = ?;
      `;
      this.db.run(sql, [
        hostData.name || existing.name,
        hostData.group_name || existing.group_name,
        hostData.host || existing.host,
        Number(hostData.port) || existing.port,
        hostData.username || existing.username,
        passwordEncrypted,
        hostData.auth_type || existing.auth_type,
        hostData.private_key !== undefined ? hostData.private_key : existing.private_key,
        hostData.key_passphrase !== undefined ? hostData.key_passphrase : existing.key_passphrase,
        hostData.public_key !== undefined ? hostData.public_key : existing.public_key,
        hostData.is_pinned !== undefined ? (hostData.is_pinned ? 1 : 0) : existing.is_pinned,
        now,
        id
      ]);
    } else {
      const maxOrderRes = this.db.exec('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM hosts');
      const maxOrder = maxOrderRes[0]?.values[0]?.[0] || 0;

      const sql = `
        INSERT INTO hosts (id, name, group_name, host, port, username, password_encrypted, auth_type, private_key, key_passphrase, public_key, is_pinned, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `;
      this.db.run(sql, [
        id,
        hostData.name || 'New Host',
        hostData.group_name || 'Default',
        hostData.host || '127.0.0.1',
        Number(hostData.port) || 22,
        hostData.username || 'root',
        passwordEncrypted,
        hostData.auth_type || 'password',
        hostData.private_key || '',
        hostData.key_passphrase || null,
        hostData.public_key || null,
        hostData.is_pinned ? 1 : 0,
        maxOrder + 1,
        now,
        now
      ]);
    }

    this._saveToDisk();
    return this.getHostById(id, false);
  }

  deleteHost(id) {
    this.db.run('DELETE FROM hosts WHERE id = ?;', [id]);
    this._saveToDisk();
    return true;
  }

  reorderHosts(orderedIds) {
    if (!Array.isArray(orderedIds)) return false;
    orderedIds.forEach((id, index) => {
      this.db.run('UPDATE hosts SET sort_order = ? WHERE id = ?;', [index + 1, id]);
    });
    this._saveToDisk();
    return true;
  }

  togglePin(id) {
    const res = this.db.exec(`SELECT is_pinned FROM hosts WHERE id = '${id}';`);
    if (res.length === 0 || res[0].values.length === 0) return false;
    const currentPin = res[0].values[0][0];
    const newPin = currentPin ? 0 : 1;
    this.db.run('UPDATE hosts SET is_pinned = ? WHERE id = ?;', [newPin, id]);
    this._saveToDisk();
    return newPin === 1;
  }

  // --- MACROS OPERATIONS ---
  getMacros() {
    const stmt = this.db.prepare('SELECT * FROM macros ORDER BY key_slot ASC');
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  saveMacro(macroData) {
    const slot = Number(macroData.key_slot);
    const existing = this.db.exec(`SELECT id FROM macros WHERE key_slot = ${slot};`);
    if (existing.length > 0 && existing[0].values.length > 0) {
      this.db.run(`
        UPDATE macros SET
          name = ?,
          command = ?,
          tag_color = ?,
          auto_enter = ?
        WHERE key_slot = ?;
      `, [
        macroData.name,
        macroData.command,
        macroData.tag_color || 'terminal-cyan',
        macroData.auto_enter !== undefined ? (macroData.auto_enter ? 1 : 0) : 1,
        slot
      ]);
    } else {
      this.db.run(`
        INSERT INTO macros (id, key_slot, name, command, tag_color, auto_enter, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `, [
        `m${slot}`,
        slot,
        macroData.name || `M${slot}`,
        macroData.command || 'echo "hello"',
        macroData.tag_color || 'terminal-cyan',
        macroData.auto_enter !== undefined ? (macroData.auto_enter ? 1 : 0) : 1,
        slot
      ]);
    }
    this._saveToDisk();
    return this.getMacros();
  }

  // --- SCRATCHPAD OPERATIONS ---
  getScratchpads() {
    const stmt = this.db.prepare('SELECT * FROM scratchpad ORDER BY bucket_index ASC');
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  saveScratchpad(bucketIndex, title, content) {
    const idx = Number(bucketIndex);
    const now = new Date().toISOString();
    const existing = this.db.exec(`SELECT id FROM scratchpad WHERE bucket_index = ${idx};`);
    if (existing.length > 0 && existing[0].values.length > 0) {
      this.db.run(`
        UPDATE scratchpad SET
          title = COALESCE(?, title),
          content = ?,
          updated_at = ?
        WHERE bucket_index = ?;
      `, [title, content, now, idx]);
    } else {
      this.db.run(`
        INSERT INTO scratchpad (id, bucket_index, title, content, updated_at)
        VALUES (?, ?, ?, ?, ?);
      `, [`b${idx}`, idx, title || `Bucket ${idx}`, content || '', now]);
    }
    this._saveToDisk();
    return this.getScratchpads();
  }

  clearAllScratchpads() {
    const now = new Date().toISOString();
    this.db.run('UPDATE scratchpad SET content = "", updated_at = ?;', [now]);
    this._saveToDisk();
    return this.getScratchpads();
  }

  // --- WEB LINKS OPERATIONS ---
  getLinks() {
    const stmt = this.db.prepare('SELECT id, name, url, icon FROM links ORDER BY id ASC LIMIT 4');
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  saveLink(id, name, url, icon) {
    this.db.run('UPDATE links SET name = ?, url = ?, icon = ? WHERE id = ?;', [name, url, icon || null, Number(id)]);
    this._saveToDisk();
    return true;
  }

  // --- SETTINGS OPERATIONS ---
  getSettings() {
    const stmt = this.db.prepare('SELECT key, value FROM settings');
    const map = {};
    while (stmt.step()) {
      const obj = stmt.getAsObject();
      map[obj.key] = obj.value;
    }
    stmt.free();
    return map;
  }

  saveSettings(settingsMap) {
    for (const [k, v] of Object.entries(settingsMap)) {
      this.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [k, String(v)]);
    }
    this._saveToDisk();
    return this.getSettings();
  }
}

module.exports = new DatabaseEngine();
