import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makePasswordVerifier} from '../public/password-setup.mjs';
import {verifyPassword} from '../worker/security.ts';

test('browser-created verifier is accepted by Worker and rejects another password', async () => {
  const password = 'A test-only password 🔐';
  const verifier = await makePasswordVerifier(password);
  assert.match(verifier, /^pbkdf2\$100000\$[0-9a-f]{48}\$[0-9a-f]{64}$/);
  assert.equal(await verifyPassword(password, verifier), true);
  assert.equal(await verifyPassword('Another test-only password', verifier), false);
  assert.notEqual(await makePasswordVerifier(password), verifier);
});
test('password setup refuses short and excessively long passwords', async () => {
  await assert.rejects(makePasswordVerifier('2468'));
  await assert.rejects(makePasswordVerifier('x'.repeat(257)));
});
