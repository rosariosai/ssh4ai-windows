// ssh4ai - AES-256-GCM Local Cryptographic Vault
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits standard for GCM
const KEY_LENGTH = 32; // 256 bits

class CryptographicVault {
  constructor() {
    this.keyDir = path.join(os.homedir(), '.nodeops');
    this.keyFile = path.join(this.keyDir, 'master.key');
    this.masterKey = this._getOrCreateMasterKey();
  }

  _getOrCreateMasterKey() {
    try {
      if (!fs.existsSync(this.keyDir)) {
        fs.mkdirSync(this.keyDir, { recursive: true });
      }

      if (fs.existsSync(this.keyFile)) {
        const storedHex = fs.readFileSync(this.keyFile, 'utf8').trim();
        if (storedHex.length === KEY_LENGTH * 2) {
          return Buffer.from(storedHex, 'hex');
        }
      }

      // Generate a new cryptographically secure 256-bit key
      const newKey = crypto.randomBytes(KEY_LENGTH);
      fs.writeFileSync(this.keyFile, newKey.toString('hex'), { mode: 0o600 });
      return newKey;
    } catch (err) {
      console.error('[Vault] Error managing master key:', err);
      // Fallback deterministic derivation based on user hostname/homedir
      const fallbackSalt = `NodeOps-Homelab-Vault-${os.userInfo().username}-${os.hostname()}`;
      return crypto.scryptSync(fallbackSalt, 'nodeops-salt', KEY_LENGTH);
    }
  }

  encrypt(plainText) {
    if (!plainText && plainText !== '') return '';
    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);
      
      let encrypted = cipher.update(String(plainText), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const tag = cipher.getAuthTag();
      
      // Compact serializable format: $aes-gcm$iv$tag$ciphertext
      return `$aes-gcm$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted}`;
    } catch (err) {
      console.error('[Vault] Encryption failure:', err);
      throw new Error('Cryptographic encryption failed');
    }
  }

  decrypt(payload) {
    if (!payload || typeof payload !== 'string') return '';
    if (!payload.startsWith('$aes-gcm$')) {
      // Legacy or unencrypted plaintext
      return payload;
    }

    try {
      const parts = payload.split('$');
      if (parts.length !== 5) {
        throw new Error('Invalid vault payload envelope');
      }

      const iv = Buffer.from(parts[2], 'hex');
      const tag = Buffer.from(parts[3], 'hex');
      const encryptedText = parts[4];

      const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('[Vault] Decryption verification failed:', err.message);
      return '';
    }
  }

  isEncrypted(value) {
    return typeof value === 'string' && value.startsWith('$aes-gcm$');
  }
}

module.exports = new CryptographicVault();
