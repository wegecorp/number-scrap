const IG_WRAPPER = /^https?:\/\/(?:www\.)?l\.instagram\.com\/?\?u=([^&]+)/i;

export function decodeInstagramWrapper(url: string): string {
  const m = url.match(IG_WRAPPER);
  if (!m) return url;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return url;
  }
}

const AGGREGATORS = [
  'linktr.ee',
  'lynk.id',
  'tap.bio',
  'beacons.ai',
  'linkin.bio',
  'carrd.co',
  'bio.link',
  'sociabuzz.com',
  'link.me',
];

export function isAggregator(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return AGGREGATORS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

export function isWhatsAppLink(url: string): boolean {
  return /(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)/i.test(url);
}

export function extractChildLinks(html: string, base: string): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/"(?:url|link|href)"\s*:\s*"(https?:\\?\/\\?\/[^"]+)"/gi)) {
    urls.add(m[1].replace(/\\\//g, '/'));
  }
  const out: string[] = [];
  for (const raw of urls) {
    let abs: string;
    try {
      abs = new URL(raw, base).toString();
    } catch {
      continue;
    }
    if (/\.(png|jpe?g|svg|gif|webp|css|js|woff2?|ico|mp4)(\?|$)/i.test(abs)) continue;
    if (/instagram\.com\/(p|reel|reels|tv|stories)\//i.test(abs)) continue;
    out.push(abs);
  }
  return [...new Set(out)];
}
