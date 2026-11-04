// Verification script for vault and SQLite engine
const vault = require('./src/main/vault.cjs');
const db = require('./src/main/db.cjs');

async function run() {
  console.log('Testing Vault encryption...');
  const secret = 'example-test-secret-not-a-real-password';
  const enc = vault.encrypt(secret);
  console.log('Encrypted value looks like $aes-gcm$...:', enc.startsWith('$aes-gcm$'), '| length:', enc.length);
  const dec = vault.decrypt(enc);
  console.log('Decrypted matches original:', dec === secret);
  if (dec !== secret) process.exit(1);

  console.log('Testing SQLite Database via sql.js...');
  await db.init();

  const hosts = db.getHosts();
  console.log('Initial hosts count:', hosts.length);
  console.log('Host 1:', hosts[0].name, hosts[0].host);

  const macros = db.getMacros();
  console.log('Initial macros count:', macros.length);

  const scratchpads = db.getScratchpads();
  console.log('Initial scratchpads count:', scratchpads.length);

  const settings = db.getSettings();
  console.log('Initial settings keys:', Object.keys(settings));

  console.log('Testing that quotes in IDs cannot change the SQL...');
  const evil = "x' OR '1'='1";
  if (db.togglePin(evil) !== false) throw new Error('togglePin accepted a malicious id');
  const found = db.getHostById(evil);
  if (found) throw new Error('getHostById matched a malicious id');
  const before = db.getHosts().length;
  db.saveHost({ id: evil, name: 'quote-test', host: '192.0.2.1', port: 22, username: 'u', password: 'p', auth_type: 'password' });
  if (db.getHosts().length !== before + 1) throw new Error('saveHost with a quote in the id did not add exactly one row');
  if (typeof db.deleteHost === 'function') db.deleteHost(evil);
  console.log('Quote handling OK');

  console.log('ALL DB AND VAULT TESTS PASSED!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
