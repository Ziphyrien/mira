import type { Cookies } from "@sveltejs/kit";

export const KEY_COOKIE = "mira_key";
export const ADMIN_COOKIE = "mira_admin";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

/** A new space key: 160 random bits as 32 Crockford characters. */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
}

export function displayKey(key: string): string {
  return key.match(/.{4}/g)!.join("-");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The space id is a hash of the key, so stored ids never reveal keys. */
export async function uidOf(key: string): Promise<string> {
  return (await sha256(`mira:space:${key}`)).slice(0, 32);
}

export function setKey(cookies: Cookies, key: string) {
  cookies.set(KEY_COOKIE, key, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 400,
  });
}

export async function adminValue(token: string): Promise<string> {
  return sha256(`mira:admin:${token}`);
}

export async function isAdmin(cookies: Cookies, token: string | undefined): Promise<boolean> {
  const value = cookies.get(ADMIN_COOKIE);
  if (!token || !value) return false;
  return equal(value, await adminValue(token));
}

export function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export async function ipDay(ip: string): Promise<string> {
  return (await sha256(`mira:ip:${ip}:${new Date().toISOString().slice(0, 10)}`)).slice(0, 24);
}
