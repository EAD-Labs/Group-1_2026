const crypto = require('crypto');

/*
 * Check a password against a Django hash.
 *
 * Format: pbkdf2_sha256$<iterations>$<salt>$<base64 digest>
 * 1,137,507 of the school's accounts use this; the rest are bare hex MD5 from
 * the pre-Django era, which we accept only because those accounts still exist.
 *
 * ponytail: no upgrade-on-login rehash. Add if we ever own those rows — today
 * the school database is read-only to us.
 */
function verifyDjangoPassword(password, encoded) {
  if (!password || !encoded) return false;

  if (encoded.startsWith('pbkdf2_sha256$')) {
    const [, iterations, salt, digest] = encoded.split('$');
    const want = Buffer.from(digest, 'base64');
    const got = crypto.pbkdf2Sync(password, salt, Number(iterations), want.length, 'sha256');
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  // Legacy unsalted MD5. Weak, and worth telling the client about.
  if (/^[0-9a-f]{32}$/.test(encoded)) {
    const got = crypto.createHash('md5').update(password).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(encoded));
  }

  return false;
}

module.exports = { verifyDjangoPassword };
