import type { Candidate } from '../../types.ts';
import { UA } from '../../http.ts';
import { parsePageText } from '../../enrich/bio-parse.ts';
import { webSearch, isSearchJunk } from '../web-search.ts';

const SKIP_HOSTS = [
  'instagram.com',
  'facebook.com',
  'youtube.com',
  'tiktok.com',
  'wikipedia.org',
  'linkedin.com',
  'tokopedia.com',
  'shopee.co.id',
  'twitter.com',
  'x.com',
  'pinterest.com',
  'whatsapp.com',
];

function skip(url: string): boolean {
  if (isSearchJunk(url)) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SKIP_HOSTS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return true;
  }
}

function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

export async function searchContactSites(queries: string[], limitPerQuery = 12): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    let urls: string[];
    try {
      urls = await webSearch(q, limitPerQuery);
    } catch (err) {
      console.warn(`[web] search gagal "${q}": ${(err as Error).message}`);
      continue;
    }
    for (const u of urls) {
      if (skip(u) || seen.has(u)) continue;
      seen.add(u);
      try {
        const res = await fetch(u, {
          redirect: 'follow',
          headers: { 'user-agent': UA, accept: 'text/html,*/*' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const html = (await res.text()).slice(0, 400_000);
        const contact = parsePageText(html);
        if (!contact.phones.length && !contact.emails.length) continue;
        const finalUrl = res.url || u;
        out.push({
          source: 'website',
          handle: finalUrl.replace(/^https?:\/\//, '').slice(0, 120),
          name: titleOf(html).split(/[|\-–]/)[0].trim() || new URL(finalUrl).hostname,
          website: finalUrl,
          phone: contact.phones[0],
          email: contact.emails[0],
          url: finalUrl,
          meta: { extraPhones: contact.phones, extraEmails: contact.emails },
        });
      } catch {
        // ponytail: halaman mati/timeout -> skip
      }
    }
  }
  return out;
}
