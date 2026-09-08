const crypto = require('crypto');
const { verifyDjangoPassword } = require('../src/services/djangoPassword');

const django = (pw, iters = 20000, salt = 'abcdefghijkl') =>
  `pbkdf2_sha256$${iters}$${salt}$${crypto.pbkdf2Sync(pw, salt, iters, 32, 'sha256').toString('base64')}`;

test('accepts the right password', () => {
  expect(verifyDjangoPassword('hunter2', django('hunter2'))).toBe(true);
});

test('rejects the wrong one', () => {
  expect(verifyDjangoPassword('hunter3', django('hunter2'))).toBe(false);
});

test('honours the iteration count in the hash', () => {
  expect(verifyDjangoPassword('hunter2', django('hunter2', 36000))).toBe(true);
});

test('handles legacy md5', () => {
  const md5 = crypto.createHash('md5').update('old').digest('hex');
  expect(verifyDjangoPassword('old', md5)).toBe(true);
  expect(verifyDjangoPassword('nope', md5)).toBe(false);
});

test('refuses empty and unknown formats', () => {
  expect(verifyDjangoPassword('', django('x'))).toBe(false);
  expect(verifyDjangoPassword('x', 'argon2$whatever')).toBe(false);
});
