import { config, hasAI, hasMaps } from '../config.ts';
import type { Candidate, ExpandedQuery } from '../types.ts';
import { extraQueriesFromSeeds } from '../ai/expand.ts';
import { fetchInstagramProfile, fetchProfilesViaInstagrapi, findHandles, mentionsFromBio, searchHandlesViaInstagrapi } from './adapters/instagram.ts';
import { searchPlaces } from './adapters/google-maps.ts';
import { searchOsm } from './adapters/osm.ts';
import { searchContactSites } from './adapters/website.ts';

function mapsTerms(q: ExpandedQuery): string[] {
  const base = [q.targetType, q.sport].filter(Boolean).join(' ').trim() || q.synonyms[0] || '';
  const city = q.city ? ` ${q.city}` : '';
  const terms = new Set<string>();
  if (base) terms.add(base + city);
  for (const s of q.synonyms.slice(0, 3)) terms.add(s + city);
  return [...terms].filter((t) => t.trim().length > 0);
}

function tournamentQueries(q: ExpandedQuery): string[] {
  const sport = q.sport || 'sepak bola';
  const city = q.city ? ` ${q.city}` : '';
  return [
    `site:instagram.com ("turnamen" OR "liga" OR "kompetisi") ${sport}${city}`.trim(),
    `site:instagram.com ("peserta" OR "juara") ${sport}${city}`.trim(),
  ];
}

function websiteQueries(q: ExpandedQuery): string[] {
  const key = [q.targetType, q.sport, q.city].filter(Boolean).join(' ').trim();
  if (!key) return [];
  return [`"${key}" kontak`, `"${key}" alamat telepon email`];
}

// Singkatan kota Indonesia -> bikin hasil search IG lebih banyak tanpa salah sasaran.
const CITY_ABBR: Record<string, string[]> = {
  'jakarta selatan': ['jaksel'],
  'jakarta utara': ['jakut'],
  'jakarta barat': ['jakbar'],
  'jakarta timur': ['jaktim'],
  'jakarta pusat': ['jakpus'],
  bandung: ['bdg'],
  surabaya: ['sby'],
  yogyakarta: ['jogja', 'yogya'],
  semarang: ['smg'],
  makassar: ['mks'],
  bekasi: ['bks'],
  medan: ['mdn'],
  malang: ['mlg'],
  denpasar: ['dps'],
  palembang: ['plm'],
};

export function cityVariants(city: string): string[] {
  const c = (city ?? '').toLowerCase().trim();
  if (!c) return [''];
  const out = [city.trim()];
  for (const [full, abbrs] of Object.entries(CITY_ABBR)) {
    if (c.includes(full)) out.push(...abbrs);
  }
  return [...new Set(out)];
}

export function searchTerms(q: ExpandedQuery): string[] {
  const terms = new Set<string>();
  const base = [q.targetType, q.sport].filter(Boolean).join(' ').trim();
  const bases = [base, q.targetType, q.sport, ...q.synonyms].map((b) => (b ?? '').trim()).filter(Boolean);
  const cities = cityVariants(q.city ?? '');

  for (const b of bases) {
    terms.add(`${b} ${cities[0]}`.trim());
    if (cities[1]) terms.add(`${b} ${cities[1]}`.trim());
    terms.add(b);
  }
  return [...terms].slice(0, 8);
}

export function tournamentSearchTerms(q: ExpandedQuery): string[] {
  const sport = q.sport || 'sepak bola';
  const terms = new Set<string>();
  for (const city of cityVariants(q.city ?? '').slice(0, 2)) {
    terms.add(`turnamen ${sport} ${city}`.trim());
    if (q.targetType) terms.add(`liga ${q.targetType} ${city}`.trim());
  }
  return [...terms].slice(0, 4);
}

function toPlainQuery(raw: string): string {
  return raw
    .replace(/site:\S+/gi, '')
    .replace(/["()]/g, '')
    .replace(/\bOR\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type IgState = { blocked: boolean; streak: number };

async function fetchProfiles(handles: string[], limit: number, label: string, ig: IgState): Promise<Candidate[]> {
  const out: Candidate[] = [];
  if (ig.blocked) return out;
  for (const h of handles.slice(0, limit)) {
    try {
      out.push(await fetchInstagramProfile(h));
      ig.streak = 0;
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(`[${label}] ${h}: ${msg}`);
      if (msg.includes('429')) {
        ig.streak++;
        if (ig.streak >= 3) {
          ig.blocked = true;
          console.warn('[ig] 429 berulang 3x -> hentikan fetch profil IG untuk run ini (IP kena rate limit).');
          break;
        }
      }
      out.push({ source: 'instagram', handle: h, name: h, url: `https://www.instagram.com/${h}` });
    }
  }
  return out;
}

function dedupe(cands: Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const c of cands) {
    const key = c.phone ? `p:${c.phone}` : `${c.source}:${c.handle ?? c.name}`;
    const prev = seen.get(key);
    if (!prev) seen.set(key, c);
    else seen.set(key, { ...prev, ...c, bio: prev.bio ?? c.bio, phone: prev.phone ?? c.phone, email: prev.email ?? c.email });
  }
  return [...seen.values()];
}

export async function discover(q: ExpandedQuery, options: { limit?: number } = {}): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const igLimit = options.limit && options.limit > 0 ? options.limit : 40;
  let igFetched = 0;
  const igState: IgState = { blocked: false, streak: 0 };
  const useInsta = config.igBackend !== 'web';
  const remaining = (): number => Math.max(0, igLimit - igFetched);
  const takeProfiles = async (handles: string[], label: string): Promise<Candidate[]> => {
    const slice = handles.slice(0, remaining());
    if (!slice.length) return [];
    igFetched += slice.length;

    if (useInsta) {
      try {
        const res = await fetchProfilesViaInstagrapi(slice);
        const ok = res.filter((r) => !(r.meta as { error?: string } | undefined)?.error).length;
        console.log(`[${label}] instagrapi: ${ok}/${res.length} profil ok`);
        if (ok > 0 || config.igBackend === 'instagrapi') return res;
        console.warn(`[${label}] instagrapi 0 hasil, fallback ke web`);
      } catch (err) {
        console.warn(`[${label}] instagrapi gagal: ${(err as Error).message}`);
        if (config.igBackend === 'instagrapi') throw err;
      }
    }

    return fetchProfiles(slice, slice.length, label, igState);
  };

  if (hasMaps) {
    for (const term of mapsTerms(q)) {
      try {
        const places = await searchPlaces(term);
        out.push(...places);
        console.log(`[maps] "${term}" -> ${places.length}`);
      } catch (err) {
        console.warn(`[maps] "${term}" gagal: ${(err as Error).message}`);
      }
    }
  }

  if (config.osmEnabled) {
    for (const term of mapsTerms(q)) {
      try {
        const places = await searchOsm(term);
        out.push(...places);
        console.log(`[osm] "${term}" -> ${places.length}`);
      } catch (err) {
        console.warn(`[osm] "${term}" gagal: ${(err as Error).message}`);
      }
    }
  }

  let handles: string[] = [];
  if (useInsta) {
    try {
      handles = await searchHandlesViaInstagrapi(searchTerms(q));
    } catch (err) {
      console.warn(`[ig] search instagrapi gagal: ${(err as Error).message}`);
    }
  }
  if (!handles.length) handles = await findHandles(q.googleQueries);
  console.log(`[ig] kandidat akun: ${handles.length} (fetch dibatasi ${igLimit})`);
  out.push(...(await takeProfiles(handles, 'ig')));

  if (remaining() > 0) {
    let tournamentHandles: string[] = [];
    if (useInsta) {
      try {
        tournamentHandles = await searchHandlesViaInstagrapi(tournamentSearchTerms(q));
      } catch (err) {
        console.warn(`[turnamen] search instagrapi gagal: ${(err as Error).message}`);
      }
    }
    if (!tournamentHandles.length) tournamentHandles = await findHandles(tournamentQueries(q), 15);
    tournamentHandles = tournamentHandles.filter((h) => !handles.includes(h));
    if (tournamentHandles.length) {
      console.log(`[turnamen] akun event: ${tournamentHandles.length}`);
      const profs = await takeProfiles(tournamentHandles.slice(0, 8), 'turnamen');
      const teamHandles = new Set<string>();
      for (const p of profs) for (const h of mentionsFromBio(p.bio ?? '')) teamHandles.add(h);
      const teams = [...teamHandles].filter((h) => !handles.includes(h));
      console.log(`[turnamen] tim dari tag: ${teams.length}`);
      out.push(...(await takeProfiles(teams, 'tim')));
    }
  }

  const wQueries = websiteQueries(q);
  if (wQueries.length) {
    const sites = await searchContactSites(wQueries);
    console.log(`[web] situs dengan kontak: ${sites.length}`);
    out.push(...sites);
  }

  if (hasAI && config.seedExpansion > 0 && remaining() > 0 && !igState.blocked) {
    const seeds = out.filter((o) => o.name).map((o) => ({ name: o.name, bio: o.bio }));
    const extra = await extraQueriesFromSeeds(q, seeds);
    if (extra.length) {
      console.log(`[ai] seed expansion +${extra.length} query`);
      let h2: string[] = [];
      if (useInsta) {
        try {
          h2 = await searchHandlesViaInstagrapi(extra.map(toPlainQuery).filter(Boolean).slice(0, 3));
        } catch {
          /* fallback di bawah */
        }
      }
      if (!h2.length) h2 = await findHandles(extra);
      out.push(...(await takeProfiles(h2.filter((h) => !handles.includes(h)), 'ig-expand')));
    }
  }

  return dedupe(out);
}
