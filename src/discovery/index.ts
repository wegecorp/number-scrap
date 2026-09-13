import { config, hasAI, hasMaps } from '../config.ts';
import type { Candidate, ExpandedQuery } from '../types.ts';
import { extraQueriesFromSeeds } from '../ai/expand.ts';
import { fetchInstagramProfile, findHandles, mentionsFromBio } from './adapters/instagram.ts';
import { searchPlaces } from './adapters/google-maps.ts';
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

async function fetchProfiles(handles: string[], limit: number, label: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const h of handles.slice(0, limit)) {
    try {
      out.push(await fetchInstagramProfile(h));
    } catch (err) {
      console.warn(`[${label}] ${h}: ${(err as Error).message}`);
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

export async function discover(q: ExpandedQuery): Promise<Candidate[]> {
  const out: Candidate[] = [];

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

  const handles = await findHandles(q.googleQueries);
  console.log(`[ig] kandidat akun: ${handles.length}`);
  out.push(...(await fetchProfiles(handles, 40, 'ig')));

  const tQueries = tournamentQueries(q);
  const tournamentHandles = (await findHandles(tQueries, 15)).filter((h) => !handles.includes(h));
  if (tournamentHandles.length) {
    console.log(`[turnamen] akun event: ${tournamentHandles.length}`);
    const profs = await fetchProfiles(tournamentHandles, 8, 'turnamen');
    const teamHandles = new Set<string>();
    for (const p of profs) for (const h of mentionsFromBio(p.bio ?? '')) teamHandles.add(h);
    const teams = [...teamHandles].filter((h) => !handles.includes(h));
    console.log(`[turnamen] tim dari tag: ${teams.length}`);
    out.push(...(await fetchProfiles(teams, 40, 'tim')));
  }

  const wQueries = websiteQueries(q);
  if (wQueries.length) {
    const sites = await searchContactSites(wQueries);
    console.log(`[web] situs dengan kontak: ${sites.length}`);
    out.push(...sites);
  }

  if (hasAI && config.seedExpansion > 0) {
    const seeds = out.filter((o) => o.name).map((o) => ({ name: o.name, bio: o.bio }));
    const extra = await extraQueriesFromSeeds(q, seeds);
    if (extra.length) {
      console.log(`[ai] seed expansion +${extra.length} query`);
      const h2 = (await findHandles(extra)).filter((h) => !handles.includes(h));
      out.push(...(await fetchProfiles(h2, 40, 'ig-expand')));
    }
  }

  return dedupe(out);
}
