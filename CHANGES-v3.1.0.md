---
source: claude
date: 2026-10-23
status: draft
---
# ssh4ai (Windows) v3.1.0 - SSH key authentication (parity with web v6-key-auth)

Per-host SSH private key authentication, same UI and rules as web release `v6-key-auth` (also includes `v6-copy-clear`). The app still has no web server: the web UI talks to the main process over IPC.

## What is new
- **Authentication selector** in Edit Host: Password (default, unchanged), Private key, Key + password fallback (key first, then password; ESXi style keyboard-interactive still works).
- Paste a key, **Load from file**, or **Generate key pair** (ed25519, comment `webssh-<name>`; a new host is saved first). Passphrase field, "Key saved" + **Replace key**, public key box with **Copy public key** and an `authorized_keys` / Home Assistant Terminal & SSH add-on hint, key icon in the host list.
- A wrong passphrase or an invalid key is rejected when saving, with a readable message; nothing is stored.
- Readable connection errors: wrong or missing passphrase, key rejected by the server, key and password both rejected.

## Safety rules
- Private keys and passphrases are encrypted with **Windows DPAPI (Electron safeStorage)**, stored as `dpapi1:` blobs. If `safeStorage.isEncryptionAvailable()` is false, saving or using a key is refused with a clear message (fail closed).
- Never returned by the API/IPC (list returns `auth_type`, `has_key`, `public_key` only), never logged, decrypted just before connecting. The renderer's raw `db-save-host` IPC can no longer write key columns.
- An empty key box on Edit keeps the stored key; an empty password keeps the stored password.

## Database migration (automatic, idempotent)
- `hosts` already had `auth_type` and `private_key` from older versions; the migration adds `key_passphrase` and `public_key` (checks `PRAGMA table_info` first, runs in one transaction, rolled back on error).
- Before the first change the database file is copied to `%USERPROFILE%\.nodeops\nodeops.db.bak-pre-keyauth-<date>`. Existing hosts stay `password` and are untouched.
- A plaintext `private_key` left by an older version is encrypted in place (with `secure_delete` + `VACUUM` so no plaintext remains in the file).
- Existing stored passwords are NOT changed (they keep using `vault.cjs` / `master.key`).

## Files
Changed: `src/main/db.cjs`, `api.cjs`, `ssh-manager.cjs`, `main.cjs`, `src/renderer/index.html`, `js/web-app.js`, `styles/web.css`, `package.json`, `package-lock.json`, `README.md`, `.gitignore`. New: `src/main/keyauth.cjs`, this file. Backup of the previous state: `_backup-v3.0.0/` (without `node_modules` and `dist`).

## Difference from the web app (deliberate)
ssh2 tries `password` before `publickey` by default, so web v6 in `key_password` mode tries the password first. Here the order is set explicitly (`authHandler`): key first, then password, as the mode is described.

## Rollback
Close the app, restore `src/`, `package.json`, `package-lock.json`, `README.md`, `.gitignore` from `_backup-v3.0.0/`, delete `src/main/keyauth.cjs`, and restore `%USERPROFILE%\.nodeops\nodeops.db` from `nodeops.db.bak-pre-keyauth-<date>` (this loses hosts or keys added after the update). The extra columns are harmless to 3.0.0 if you only restore the code.
