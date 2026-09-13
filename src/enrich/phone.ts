import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { config } from '../config.ts';

export function normalizePhone(raw: string, country = config.defaultCountry as CountryCode): string | null {
  const cleaned = (raw ?? '').replace(/[^\d+]/g, '');
  if (cleaned.length < 7) return null;
  const p = parsePhoneNumberFromString(cleaned, country);
  if (!p || !p.isValid()) return null;
  return p.number;
}

export function extractWhatsAppNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/wa\.me\/\+?(\d{6,15})/gi)) out.push(m[1]);
  for (const m of text.matchAll(/[?&]phone=(\d{6,15})/gi)) out.push(m[1]);
  return [...new Set(out.map((n) => normalizePhone(n)).filter((n): n is string => !!n))];
}

// ponytail: sengaja sempit ke nomor mobile Indonesia (+62 8xx / 08xx) supaya minim false positive.
// Perlu negara lain -> ubah/lewati pola ini dan andalkan extractWhatsAppNumbers.
const ID_MOBILE = /(?:\+?62|0)8\d{2}[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}/g;

export function extractPhones(text: string, country = config.defaultCountry as CountryCode): string[] {
  const out = new Set<string>(extractWhatsAppNumbers(text));
  for (const m of text.matchAll(ID_MOBILE)) {
    const n = normalizePhone(m[0], country);
    if (n) out.add(n);
  }
  return [...out];
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function extractEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
}
