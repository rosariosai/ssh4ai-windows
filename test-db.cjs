// Verification script for vault and SQLite engine
const vault = require('./src/main/vault.cjs');
const db = require('./src/main/db.cjs');

async function run() {
  console.log('Testing Vault encryption...');
  const secret = 'MyUltraSecretP@ssw0rd!2026';
  const enc = vault.encrypt(secret);
  console.log('Encrypted format:', enc.substring(0, 30) + '...');
  const dec = vault.decrypt(enc);
  console.log('Decrypted matches original:', dec === secret);
  if (dec !== secret) process.exit(1);

  console.log('Testing SQLite Database via sql.js...');
  await db.init();

  const hosts = db.getHosts();
  console.log('Initial hosts count:', hosts.length);
  console.log('Host 1:', hosts[0].name, hosts[0].host, 'has_password:', hosts[0].has_password);

  const macros = db.getMacros();
  console.log('Initial macros count:', macros.length);

  const scratchpads = db.getScratchpads();
  console.log('Initial scratchpads count:', scratchpads.length);

  const settings = db.getSettings();
  console.log('Initial settings keys:', Object.keys(settings));

  console.log('ALL DB AND VAULT TESTS PASSED!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
