import argon2 from 'argon2';

export const validPassword = (value) =>
  typeof value === 'string' && [...value].length >= 12 && [...value].length <= 128;
export const hashPassword = (value) =>
  argon2.hash(value, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
export async function verifyPassword(hash, value) {
  if (typeof value !== 'string' || value.length > 256) return false;
  try {
    return await argon2.verify(hash, value);
  } catch {
    return false;
  }
}
