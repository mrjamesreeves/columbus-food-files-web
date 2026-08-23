#!/usr/bin/env node
/**
 * Generate EDIT_PASSWORD_HASH for Vercel. The password is never stored.
 *   node scripts/hash-password.js
 */
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
process.stdout.write('Password (typed in the clear, so do this somewhere private): ');
rl.question('', (pw) => {
  rl.close();
  if (!pw) { console.error('\nNothing entered.'); process.exit(1); }
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  console.log('\n\nEDIT_PASSWORD_HASH=');
  console.log(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`);
  console.log('\nSESSION_SECRET=');
  console.log(crypto.randomBytes(32).toString('hex'));
  console.log('\nAdd both to Vercel -> Settings -> Environment Variables.\n');
});
