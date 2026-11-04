// ssh4ai - SSH private key authentication helpers (port of web release v6-key-auth).
// Private keys and passphrases are encrypted at rest with Electron safeStorage (Windows DPAPI).
// They are never logged, never returned by the API/IPC, and never leave the main process.
'use strict';
const { utils: sshUtils } = require('ssh2');

const AUTH_TYPES = ['password', 'key', 'key_password']; // key_password = key first, then password
const PREFIX = 'dpapi1:';

// ---- secret storage (Electron safeStorage) --------------------------------
let storageOverride = null; // tests only: inject a fake safeStorage when running under plain node
function setSecureStorageForTests(s) { storageOverride = s; }

function secureStorage() {
  if (storageOverride) return storageOverride;
  try {
    const e = require('electron');
    return (e && e.safeStorage) || null; // under plain node require('electron') is just a path string
  } catch (e) { return null; }
}

function isAvailable() {
  try { const s = secureStorage(); return !!(s && s.isEncryptionAvailable()); } catch (e) { return false; }
}

const UNAVAILABLE_MSG = 'Key storage is disabled: Windows secure storage (DPAPI) is not available, so SSH keys cannot be saved or used';

function unavailableError() { const e = new Error(UNAVAILABLE_MSG); e.status = 503; return e; }

function encryptSecret(plain) {
  if (!isAvailable()) throw unavailableError();
  return PREFIX + secureStorage().encryptString(String(plain)).toString('base64');
}

function decryptSecret(blob) {
  if (!isAvailable()) throw unavailableError();
  const s = String(blob || '');
  if (!s.startsWith(PREFIX)) {
    throw new Error('Stored key is in an unsupported legacy format - open Edit Host and add or generate the key again');
  }
  try {
    return secureStorage().decryptString(Buffer.from(s.slice(PREFIX.length), 'base64'));
  } catch (e) {
    throw new Error('Stored key cannot be decrypted (it was saved by another Windows user or on another computer) - add the key again');
  }
}

const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);

// ---- key parsing -----------------------------------------------------------
function normKey(pem) {
  return String(pem || '').replace(/\r\n?/g, '\n').trim() + '\n';
}

// Throws an Error with a readable message that never includes key material.
function parsePrivateKey(pem, passphrase) {
  let k;
  try { k = sshUtils.parseKey(pem, passphrase || undefined); } catch (e) { k = e; }
  const key = Array.isArray(k) ? k[0] : k;
  if (key instanceof Error) {
    if (/passphrase|encrypted|decrypt|integrity|bad/i.test(String(key.message))) {
      throw new Error('Wrong or missing key passphrase');
    }
    throw new Error('Not a valid private key (supported: OpenSSH or PEM RSA / ed25519 / ECDSA)');
  }
  if (typeof key.isPrivateKey === 'function' && !key.isPrivateKey()) {
    throw new Error('That is a public key - paste the PRIVATE key');
  }
  return key;
}

function publicLine(key, comment) {
  return key.type + ' ' + key.getPublicSSH().toString('base64') + (comment ? ' ' + comment : '');
}

// Validates and encrypts the key fields of a request body. Returns null if no key was sent.
// A wrong passphrase / invalid key throws and nothing is stored.
function keyFromBody(body, deviceName) {
  const raw = typeof body.private_key === 'string' ? body.private_key : '';
  if (!raw.trim()) return null;
  if (!isAvailable()) throw unavailableError();
  const pem = normKey(raw);
  const pass = body.key_passphrase ? String(body.key_passphrase) : '';
  const parsed = parsePrivateKey(pem, pass);
  return { priv: encryptSecret(pem), pass: pass ? encryptSecret(pass) : null, pub: publicLine(parsed, 'webssh-' + deviceName) };
}

// New ed25519 pair; the private key is returned as an encrypted blob only.
function generateKeyPair(deviceName) {
  if (!isAvailable()) throw unavailableError();
  const pair = sshUtils.generateKeyPairSync('ed25519', { comment: 'webssh-' + deviceName });
  return { priv: encryptSecret(pair.private), pub: pair.public.trim() };
}

// Public key of a stored private key (when the public key was not saved yet).
function derivePublicKey(row, deviceName) {
  const key = parsePrivateKey(decryptSecret(row.private_key), row.key_passphrase ? decryptSecret(row.key_passphrase) : '');
  return publicLine(key, 'webssh-' + deviceName);
}

// ---- connect ---------------------------------------------------------------
// Decrypts just in time. The result must only be handed to ssh2, never logged or returned.
function resolveKeyMaterial(host) {
  if (!host.private_key) throw new Error('No private key stored for this host - open Edit Host and add or generate one');
  const privateKey = decryptSecret(host.private_key);
  const passphrase = host.key_passphrase ? decryptSecret(host.key_passphrase) : '';
  parsePrivateKey(privateKey, passphrase);
  return { privateKey, passphrase };
}

function authMode(host) {
  return AUTH_TYPES.includes(host && host.auth_type) ? host.auth_type : 'password';
}

// ssh2 auth options by mode. password: unchanged behaviour (tryKeyboard for ESXi).
// key: publickey only. key_password: publickey first, then password / keyboard-interactive.
// ssh2 tries `password` BEFORE `publickey` by default, so the order is set explicitly with authHandler.
function authOptions(mode, host, material) {
  if (mode === 'password') {
    const o = { tryKeyboard: true };
    if (host.password_plain) o.password = host.password_plain;
    return o;
  }
  const o = { privateKey: material.privateKey, tryKeyboard: false, authHandler: ['publickey'] };
  if (material.passphrase) o.passphrase = material.passphrase;
  if (mode === 'key_password' && host.password_plain) {
    o.password = host.password_plain;
    o.tryKeyboard = true; // ESXi style servers ask for the password via keyboard-interactive
    o.authHandler = ['publickey', 'password', 'keyboard-interactive'];
  }
  return o;
}

// Readable connection errors (ssh2 messages never contain key material).
function friendlyConnectError(mode, err) {
  const msg = String((err && err.message) || err || 'connection failed');
  if (/Cannot parse privateKey|privateKey/i.test(msg) && /passphrase|encrypted/i.test(msg)) return 'SSH: wrong or missing key passphrase';
  if (/Cannot parse privateKey/i.test(msg)) return 'SSH: the stored private key is not valid';
  if (/All configured authentication methods failed/i.test(msg)) {
    if (mode === 'key') return 'SSH: authentication failed - the server rejected the private key (is the public key installed on the host?)';
    if (mode === 'key_password') return 'SSH: authentication failed - the server rejected both the private key and the password';
  }
  return 'SSH: ' + msg;
}

module.exports = {
  AUTH_TYPES, isAvailable, isEncrypted, encryptSecret, decryptSecret, setSecureStorageForTests,
  parsePrivateKey, publicLine, keyFromBody, generateKeyPair, derivePublicKey,
  resolveKeyMaterial, authMode, authOptions, friendlyConnectError, UNAVAILABLE_MSG
};
