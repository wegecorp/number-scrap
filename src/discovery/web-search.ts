import { config } from '../config.ts';
import { UA } from '../http.ts';

// Host yang bukan hasil pencarian nyata (mesin pencari, archive, dsb). Cegah lead sampah.
const JUNK_HOSTS = [
  'duckduckgo.com',
  'google.',
  'bing.com',
  'yahoo.',
  'yandex.',
  'w3.org',
  'web.archive.org',
  'creativecommons.org',
  'github.com',
  'opnxng.com',
  'searx.',
  'searxng',
];

export function isSearchJunk(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return JUNK_HOSTS.some((d) => host === d || host.endsWith('.' + d) || host.includes(d));
}

export async function webSearch(query: string, limit = 25): Promise<string[]> {
  const provider = config.searchProvider;
  if (provider === 'google-cse' && config.googleCseKey && config.googleCseCx) return googleCse(query, limit);
  if (provider === 'duckduckgo') return duckduckgo(query, limit);
  if (provider === 'searxng') return searxng(query, limit);

  // auto: coba searxng lalu duckduckgo
  try {
    const r = await searxng(query, limit);
    if (r.length) return r;
  } catch {
    /* jatuh ke duckduckgo */
  }
  try {
    return await duckduckgo(query, limit);
  } catch (err) {
    warnOnce(`[search] semua provider gagal: ${(err as Error).message}`);
    return [];
  }
}

let warned = false;
function warnOnce(msg: string): void {
  if (warned) return;
  warned = true;
  console.warn(msg);
}

async function searxng(query: string, limit: number): Promise<string[]> {
  const base = config.searxngUrl.replace(/\/+$/, '');
  if (!base) throw new Error('SEARXNG_URL kosong');
  const url = `${base}/search?q=${encodeURIComponent(query)}&language=${config.language}`;
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`searxng ${res.status}`);
  const html = await res.text();

  const out: string[] = [];
  for (const m of html.matchAll(/<h3[^>]*>\s*<a[^>]+href="([^"]+)"/gi)) out.push(m[1]);
  if (!out.length) for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/gi)) out.push(m[1]);

  const cleaned = [...new Set(out)].filter((u) => !isSearchJunk(u));
  if (!cleaned.length) throw new Error('searxng: 0 hasil valid');
  return cleaned.slice(0, limit);
}

async function duckduckgo(query: string, limit: number): Promise<string[]> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const html = await res.text();
  if (/anomaly|challenge|captcha/i.test(html)) throw new Error('duckduckgo diblokir (anomaly)');
  // Hanya ambil link hasil sesungguhnya (param uddg). JANGAN pindai semua URL di halaman.
  const out: string[] = [];
  for (const m of html.matchAll(/uddg=([^&"']+)/g)) {
    try {
      out.push(decodeURIComponent(m[1]));
    } catch {
      /* lewati malformed */
    }
  }
  const cleaned = [...new Set(out)].filter((u) => !isSearchJunk(u));
  if (!cleaned.length) throw new Error('duckduckgo: 0 hasil (mungkin diblokir)');
  return cleaned.slice(0, limit);
}

async function googleCse(query: string, limit: number): Promise<string[]> {
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.searchParams.set('key', config.googleCseKey);
  u.searchParams.set('cx', config.googleCseCx);
  u.searchParams.set('q', query);
  u.searchParams.set('num', String(Math.min(limit, 10)));
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`google-cse ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { items?: Array<{ link: string }> };
  return (json.items ?? []).map((i) => i.link).filter((u2) => !isSearchJunk(u2));
}
