const crypto = require('crypto');

// 32 characters, no 0/O/1/I/l — avoids anyone misreading an ID off a
// receipt or a support ticket. Not meant to be a secret, just unambiguous.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';

/**
 * generateId('BUS') -> 'BUS_7hK2mQx9Pw4t'
 *
 * These are identifiers, not credentials — safe to appear in a URL, a
 * receipt, a log line. They must NEVER be derived from a human-readable
 * name (a business's display name can change; its internal ID never
 * should), and they must never double as an access secret — access is
 * controlled by Firebase Auth + custom claims + security rules, not by
 * whether someone happens to know an ID string.
 */
function generateId(prefix) {
  if (!prefix || typeof prefix !== 'string') {
    throw new Error('generateId requires a prefix, e.g. generateId("BUS")');
  }
  const bytes = crypto.randomBytes(12);
  let suffix = '';
  for (let i = 0; i < bytes.length; i++) {
    suffix += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return prefix.toUpperCase() + '_' + suffix;
}

module.exports = { generateId };
