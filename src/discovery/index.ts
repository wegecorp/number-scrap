import type { Candidate, ExpandedQuery } from '../types.ts';
import { findHandles, fetchInstagramProfile } from './adapters/instagram.ts';
import { searchPlaces } from './adapters/google-maps.ts';

function mapsTerms(q: ExpandedQuery): string[] {
  const base = [q.targetType, q.sport].filter(Boolean).join(' ').trim() || q.synonyms[0] || '';
  const city = q.city ? ` ${q.city}` : '';
  const terms = new Set<string>();
  if (base) terms.add(base + city);
  for (const s of q.synonyms.slice(0, 3)) terms.add(s + city);
  return [...terms].filter((t) => t.trim().length > 0);
}

export async function discover(q: ExpandedQuery): Promise<Candidate[]> {
  const out: Candidate[] = [];

  for (const term of mapsTerms(q)) {
    try {
      const places = await searchPlaces(term);
      out.push(...places);
      console.log(`[maps] "${term}" -> ${places.length}`);
    } catch (err) {
      console.warn(`[maps] "${term}" gagal: ${(err as Error).message}`);
    }
  }

  const handles = await findHandles(q.googleQueries);
  console.log(`[ig] kandidat akun: ${handles.length}`);
  for (const h of handles) {
    try {
      out.push(await fetchInstagramProfile(h));
    } catch (err) {
      console.warn(`[ig] ${h}: ${(err as Error).message}`);
      out.push({ source: 'instagram', handle: h, name: h, url: `https://www.instagram.com/${h}` });
    }
  }

  return out;
}
