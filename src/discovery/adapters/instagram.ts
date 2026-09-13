import { config } from '../../config.ts';
import { normalizePhone } from '../../enrich/phone.ts';
import type { Candidate } from '../../types.ts';
import { webSearch } from '../web-search.ts';

const RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'tv', 'stories', 'accounts', 'direct', 'about']);

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
  const headers: Record<string, string> = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'x-ig-app-id': '936619743392459',
    accept: '*/*',
  };
  if (config.igSessionId) headers.cookie = `sessionid=${config.igSessionId}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
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
