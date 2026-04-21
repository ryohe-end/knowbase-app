// lib/password.ts
// Node-only password hashing using scrypt (built-in, no new deps).
// Accepts legacy "hashed_<plain>" format during migration.

import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

const KEY_LEN = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// Node's scrypt/timingSafeEqual types vary between @types/node versions over
// whether Buffer satisfies BinaryLike/ArrayBufferView. Cast at the boundary.
type BinLike = Parameters<typeof scryptSync>[0];
type SafeView = Parameters<typeof timingSafeEqual>[0];

function toBin(b: Buffer): BinLike {
  return b as unknown as BinLike;
}
function toView(b: Buffer): SafeView {
  return b as unknown as SafeView;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, toBin(salt), KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | undefined | null): boolean {
  if (!stored) return false;

  // Legacy mock format — kept so existing accounts can still log in, then
  // callers should rehash on success via hashPassword().
  if (stored.startsWith("hashed_")) {
    const a = Buffer.from(stored);
    const b = Buffer.from(`hashed_${password}`);
    return a.length === b.length && timingSafeEqual(toView(a), toView(b));
  }

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  try {
    const derived = scryptSync(password, toBin(salt), expected.length, { N, r, p });
    return derived.length === expected.length && timingSafeEqual(toView(derived), toView(expected));
  } catch {
    return false;
  }
}

/** True if the stored hash uses the legacy format and should be upgraded. */
export function needsRehash(stored: string | undefined | null): boolean {
  return !stored || !stored.startsWith("scrypt$");
}

/** Validates a new password. Returns error message or null if valid. */
export function validateNewPassword(pw: unknown): string | null {
  if (typeof pw !== "string") return "パスワードは文字列で入力してください";
  if (pw.length < 8) return "パスワードは8文字以上にしてください";
  if (pw.length > 128) return "パスワードは128文字以内にしてください";
  // Require at least one letter and one digit.
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    return "パスワードは英字と数字をそれぞれ1文字以上含めてください";
  }
  return null;
}
