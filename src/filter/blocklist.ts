import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type Blocklist = { terms: string[]; hosts: string[] };

// Bawaan (dipakai walau blocklist.txt tidak ada / dikosongkan).
const DEFAULT_TERMS = [
  'bokep', 'xxx', 'porno', 'porn', 'onlyfans', 'adult', 'colmek', 'bispak',
  'judi', 'togel', 'slot gacor', 'slot88', 'maxwin', 'bandar togel',
  'pinjol', 'pinjaman online', 't.me/',
];
const DEFAULT_HOSTS = ['bit.ly', 's.id', 'tinyurl.com', 't.co', '.xxx', '.porn', '.adult', '.sex', '.cam'];

let cached: Blocklist | null = null;

export function loadBlocklist(file = 'blocklist.txt', reload = false): Blocklist {
  if (cached && !reload) return cached;
  const terms = new Set(DEFAULT_TERMS);
  const hosts = new Set(DEFAULT_HOSTS);

  if (existsSync(file)) {
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const lower = line.toLowerCase();
      if (lower.startsWith('term:')) terms.add(line.slice(5).trim().toLowerCase());
      else if (lower.startsWith('host:')) hosts.add(line.slice(5).trim().toLowerCase());
      else if (line.includes('.')) hosts.add(lower);
      else terms.add(lower);
    }
  }

  cached = { terms: [...terms].filter(Boolean), hosts: [...hosts].filter(Boolean) };
  return cached;
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isBadText(text: string | null | undefined, bl: Blocklist = loadBlocklist()): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return bl.terms.some((t) => lower.includes(t));
}

export function isBadUrl(url: string | null | undefined, bl: Blocklist = loadBlocklist()): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return bl.hosts.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h || host.endsWith('.' + h)));
}

export function isBadCandidate(
  c: { name?: string | null; bio?: string | null; website?: string | null; url?: string | null; handle?: string | null },
  bl: Blocklist = loadBlocklist(),
): boolean {
  if (isBadUrl(c.website, bl) || isBadUrl(c.url, bl)) return true;
  const text = [c.name, c.handle, c.bio].filter(Boolean).join(' \n ');
  return isBadText(text, bl);
}

const PLATFORM_HOSTS = [
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'google.com',
  'openstreetmap.org',
  'linktr.ee',
  'lynk.id',
  'wa.me',
  'whatsapp.com',
];

function isPlatformHost(host: string): boolean {
  return !host || PLATFORM_HOSTS.some((p) => host === p || host.endsWith('.' + p));
}

/**
 * Tentukan apa yang layak diblokir dari sebuah lead.
 * Hanya `website` (situs milik lead) yang dipertimbangkan sebagai host —
 * `url` diabaikan karena itu halaman sumber (instagram/osm/maps), bukan milik lead.
 */
export function blockTargetForLead(lead: {
  website?: string | null;
  handle?: string | null;
  name: string;
}): string {
  const host = hostOf(lead.website || '');
  if (!isPlatformHost(host)) return host;
  return lead.handle || lead.name;
}

export function appendBlocklist(value: string, file = 'blocklist.txt'): string {
  const isHost = value.startsWith('.') || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value);
  const line = `${isHost ? 'host' : 'term'}:${value.toLowerCase()}`;
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (!existing.toLowerCase().split(/\r?\n/).includes(line)) {
    writeFileSync(file, existing.replace(/\s*$/, '') + '\n' + line + '\n');
    cached = null;
  }
  return line;
}
