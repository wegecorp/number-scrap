import { config } from '../../config.ts';
import { normalizePhone } from '../../enrich/phone.ts';
import type { Candidate } from '../../types.ts';

// Nominatim / OpenStreetMap: gratis, tanpa API key. Wajib User-Agent jelas + maks 1 req/detik.
type OsmAddress = { city?: string; town?: string; village?: string; county?: string; state?: string };
type OsmExtra = Record<string, string>;
type OsmResult = {
  osm_type?: string;
  osm_id?: number;
  display_name?: string;
  name?: string;
  address?: OsmAddress;
  extratags?: OsmExtra;
  namedetails?: Record<string, string>;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function first(...vals: Array<string | undefined>): string | undefined {
  for (const v of vals) if (v && v.trim()) return v.trim();
  return undefined;
}

export function mapOsmResult(r: OsmResult): Candidate | null {
  const extra = r.extratags ?? {};
  const rawPhone = first(extra.phone, extra['contact:phone'], extra['contact:mobile'], extra.mobile);
  const name = first(r.namedetails?.name, r.name, r.display_name?.split(',')[0]);
  if (!name) return null;

  const city = first(r.address?.city, r.address?.town, r.address?.village, r.address?.county);
  return {
    source: 'osm',
    handle: r.osm_type && r.osm_id ? `osm:${r.osm_type}:${r.osm_id}` : `osm:${name}`,
    name,
    city,
    phone: rawPhone ? normalizePhone(rawPhone) ?? undefined : undefined,
    rawPhone,
    email: first(extra.email, extra['contact:email']),
    website: first(extra.website, extra['contact:website'], extra.url),
    url: r.osm_type && r.osm_id ? `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}` : undefined,
    meta: {
      osmType: r.osm_type,
      sport: first(extra.sport, extra['sport:1']),
      amenity: first(extra.amenity, extra.leisure, extra.club),
    },
  };
}

export async function searchOsm(query: string, limit = 20): Promise<Candidate[]> {
  if (!config.osmEnabled) return [];
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', query);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('extratags', '1');
  u.searchParams.set('namedetails', '1');
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('countrycodes', config.region.toLowerCase());

  const res = await fetch(u, {
    headers: { 'user-agent': config.osmUserAgent, accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`osm ${res.status}`);
  const json = (await res.json()) as OsmResult[];
  // Hormati batas 1 req/detik Nominatim.
  await sleep(1100);
  return json.map(mapOsmResult).filter((c): c is Candidate => c !== null);
}
