import bcrypt from 'bcrypt';

/**
 * Password hashing helpers. Thin wrapper around bcrypt so the cost
 * parameter comes from env (BCRYPT_ROUNDS, default 10) and is centralized
 * here — services and the seed script both call these helpers.
 */

export async function hashPassword(
  plain: string,
  rounds?: number
): Promise<string> {
  const cost = rounds ?? Number(process.env.BCRYPT_ROUNDS ?? 10);
  return bcrypt.hash(plain, cost);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
