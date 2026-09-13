import { config } from '../../config.ts';
import { normalizePhone } from '../../enrich/phone.ts';
import type { Candidate } from '../../types.ts';
import { webSearch } from '../web-search.ts';

const RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'tv', 'stories', 'accounts', 'direct', 'about']);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (csrfToken !== null) return csrfToken;
  csrfToken = '';
  try {
    const res = await fetch('https://www.instagram.com/', {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    const cookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const c of cookies) {
      if (c.startsWith('csrftoken=')) {
        csrfToken = c.split(';')[0].slice('csrftoken='.length);
        return csrfToken;
      }
    }
    const html = await res.text();
    csrfToken = html.match(/"csrf_token":"([^"]+)"/)?.[1] ?? '';
  } catch {
    // ponytail: csrftoken opsional; request tetap jalan tanpanya
  }
  return csrfToken;
}

// Proxy opsional untuk IG (tanpa dep wajib): set IG_PROXY_URL, lalu `npm i undici`.
let dispatcher: unknown;
let dispatcherResolved = false;

async function getDispatcher(): Promise<unknown> {
  if (dispatcherResolved) return dispatcher;
  dispatcherResolved = true;
  const proxy = (process.env.IG_PROXY_URL ?? '').trim();
  if (!proxy) return (dispatcher = undefined);
  try {
    const mod = 'undici';
    const undici = (await import(mod)) as { ProxyAgent: new (url: string) => unknown };
    dispatcher = new undici.ProxyAgent(proxy);
    console.log('[ig] proxy aktif:', proxy.replace(/\/\/[^@]*@/, '//***@'));
  } catch {
    console.warn('[ig] IG_PROXY_URL diisi tapi paket undici belum terpasang (jalankan: npm i undici).');
  }
  return dispatcher;
}

// ponytail: retry khusus 429 (rate limit IG). Backoff tetap; tambah varian kalau perlu.
async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<Response> {
  const backoff = [4000, 10000];
  const dispatcher = await getDispatcher();
  const init = { headers, signal: AbortSignal.timeout(15000), ...(dispatcher ? { dispatcher } : {}) } as RequestInit;
  let lastErr: unknown = new Error('IG gagal');
  for (let i = 0; i <= backoff.length; i++) {
    if (i > 0) await sleep(backoff[i - 1]);
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    lastErr = new Error(
      'IG 429 (rate limit level IP/akun, bukan salah config). Tunggu beberapa jam, naikkan IG_FETCH_DELAY_MS, atau set IG_PROXY_URL.',
    );
  }
  throw lastErr as Error;
}

export function handlesFromUrls(urls: string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    const m = u.match(/instagram\.com\/([A-Za-z0-9_.]+)/);
    if (!m) continue;
    const h = m[1].toLowerCase();
    if (RESERVED.has(h) || h.length < 3) continue;
    out.add(h);
  }
  return [...out];
}

export function mentionsFromBio(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/@([A-Za-z0-9_.]{3,30})/g)) {
    const h = m[1].toLowerCase();
    if (RESERVED.has(h) || h.includes('instagram')) continue;
    out.add(h);
  }
  return [...out];
}

export async function findHandles(queries: string[], perQuery = 25): Promise<string[]> {
  const found = new Set<string>();
  for (const q of queries) {
    try {
      const urls = await webSearch(q, perQuery);
      for (const h of handlesFromUrls(urls)) found.add(h);
    } catch (err) {
      console.warn(`[ig] search gagal "${q}": ${(err as Error).message}`);
    }
  }
  return [...found];
}

type IgUser = {
  username?: string;
  full_name?: string;
  biography?: string;
  external_url?: string;
  business_phone_number?: string;
  public_phone_number?: string;
  contact_phone_number?: string;
  business_email?: string;
  public_email?: string;
  category_name?: string;
  is_business_account?: boolean;
  edge_followed_by?: { count?: number };
  edge_owner_to_timeline_media?: {
    count?: number;
    edges?: Array<{
      node?: { taken_at_timestamp?: number; edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> } };
    }>;
  };
};

export async function fetchInstagramProfile(handle: string): Promise<Candidate> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
  // sessionid sering ter-salain dalam bentuk URL-encoded (mis. %3A) -> decode dulu.
  const sid = config.igSessionId ? decodeURIComponent(config.igSessionId) : '';
  const csrf = sid ? await getCsrfToken() : '';

  const headers: Record<string, string> = {
    'user-agent': UA,
    'x-ig-app-id': '936619743392459',
    'x-ig-www-claim': '0',
    'x-requested-with': 'XMLHttpRequest',
    'accept-language': 'id-ID,id;q=0.9,en;q=0.8',
    referer: `https://www.instagram.com/${handle}/`,
    accept: '*/*',
  };
  if (sid) {
    headers.cookie = `sessionid=${sid}` + (csrf ? `; csrftoken=${csrf}` : '');
    if (csrf) headers['x-csrftoken'] = csrf;
  }

  if (config.igFetchDelayMs > 0) await sleep(config.igFetchDelayMs + Math.floor(Math.random() * 1000));

  const res = await fetchWithRetry(url, headers);
  if (!res.ok) throw new Error(`IG ${res.status}`);
  const json = (await res.json()) as { data?: { user?: IgUser } };
  const u = json.data?.user;
  if (!u) throw new Error('IG profil kosong');

  const rawPhone = u.business_phone_number || u.public_phone_number || u.contact_phone_number || '';
  const captions = (u.edge_owner_to_timeline_media?.edges ?? [])
    .map((e) => e.node?.edge_media_to_caption?.edges?.[0]?.node?.text ?? '')
    .filter(Boolean);
  const lastPostAt = (u.edge_owner_to_timeline_media?.edges ?? [])
    .map((e) => e.node?.taken_at_timestamp ?? 0)
    .sort((a, b) => b - a)[0];

  return {
    source: 'instagram',
    handle,
    name: u.full_name || handle,
    bio: u.biography || captions.join(' '),
    website: u.external_url || undefined,
    phone: rawPhone ? normalizePhone(rawPhone) ?? undefined : undefined,
    rawPhone: rawPhone || undefined,
    email: u.business_email || u.public_email || undefined,
    url: `https://www.instagram.com/${handle}`,
    meta: {
      category: u.category_name,
      isBusiness: u.is_business_account ?? false,
      followers: u.edge_followed_by?.count ?? null,
      posts: u.edge_owner_to_timeline_media?.count ?? null,
      lastPostAt: lastPostAt || null,
      externalUrl: u.external_url ?? null,
    },
  };
}
