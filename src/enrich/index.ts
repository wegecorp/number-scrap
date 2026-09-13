import type { Candidate } from '../types.ts';
import { UA } from '../http.ts';
import { extractPhones, extractWhatsAppNumbers } from './phone.ts';
import { parseBio, parsePageText, mergeContact, type Contact } from './bio-parse.ts';
import { decodeInstagramWrapper, extractChildLinks, isAggregator } from './link-resolve.ts';

const EMPTY: Contact = { phones: [], emails: [] };

export async function enrichContact(c: Candidate): Promise<Contact> {
  let contact = EMPTY;
  if (c.bio) contact = mergeContact(contact, parseBio(c.bio));
  if (c.phone) contact = mergeContact(contact, { phones: [c.phone], emails: [] });
  if (c.email) contact = mergeContact(contact, { phones: [], emails: [c.email] });

  const seeds = [c.website].filter((x): x is string => !!x);
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = seeds.map((url) => ({ url, depth: 0 }));
  let fetched = 0;

  while (queue.length && fetched < 25) {
    const item = queue.shift()!;
    if (item.depth > 2) continue;
    const url = decodeInstagramWrapper(item.url);
    if (visited.has(url)) continue;
    visited.add(url);
    fetched++;

    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(8000),
      });
      const finalUrl = res.url || url;
      const html = await res.text();

      contact = mergeContact(contact, { phones: extractWhatsAppNumbers(html), emails: [] });
      contact = mergeContact(contact, parsePageText(html));

      if (isAggregator(finalUrl) || isAggregator(url)) {
        for (const child of extractChildLinks(html, finalUrl)) {
          if (queue.length > 40) break;
          if (isWhatsAppUrl(child)) {
            contact = mergeContact(contact, { phones: extractPhones(child), emails: [] });
            continue;
          }
          queue.push({ url: child, depth: item.depth + 1 });
        }
      }
    } catch {
      // ponytail: halaman mati / butuh JS -> skip. Lead tetap dipakai apa adanya.
    }
  }

  return contact;
}

function isWhatsAppUrl(url: string): boolean {
  return /(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)/i.test(url);
}
