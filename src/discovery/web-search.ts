import { config } from '../config.ts';
import { UA } from '../http.ts';

export async function webSearch(query: string, limit = 25): Promise<string[]> {
  if (config.searchProvider === 'google-cse' && config.googleCseKey && config.googleCseCx) {
    return googleCse(query, limit);
  }
  return duckduckgo(query, limit);
}

function decodeUddg(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/uddg=([^&"']+)/g)) {
    try {
      out.push(decodeURIComponent(m[1]));
    } catch {
      /* ignore malformed */
    }
  }
  for (const m of html.matchAll(/https?:\/\/[^"'\s<>]+/g)) out.push(m[0]);
  return out;
}

async function duckduckgo(query: string, limit: number): Promise<string[]> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`duckduckgo ${res.status}`);
  const html = await res.text();
  return [...new Set(decodeUddg(html))].slice(0, limit);
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
  return (json.items ?? []).map((i) => i.link);
}
