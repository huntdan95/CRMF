import { randomBytes, scrypt, type ScryptOptions } from 'node:crypto';

/**
 * Crew passwords are hashed here, when Travis sets one in admin, and
 * checked by the Next app at sign-in (`verifyPassword` in
 * src/lib/crew-server.ts). Both sides read the same self-describing string,
 * so keep the format in sync:
 *
 *   scrypt:<N>:<r>:<p>:<salt, base64url>:<hash, base64url>
 *
 * Leading and trailing spaces are trimmed on both sides (zod `.trim()` here,
 * explicitly at sign-in) so a password pasted from a text message still works.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashCrewPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join(':');
}
