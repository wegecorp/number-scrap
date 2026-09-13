import type { Candidate, ExpandedQuery } from '../types.ts';

const SPORT_TERMS = [
  'sepak bola', 'sepakbola', 'sepakbola', 'futsal', 'basket', 'voli', 'badminton', 'bulu tangkis',
  'renang', 'atletik', 'esport', 'e-sport', 'panahan', 'tenis', 'bola', 'liga', 'turnamen',
  'ssb', 'sekolah sepak bola', 'sekolah sepakbola', 'akademi', 'klub', 'club', 'komunitas',
  'tim', 'team', 'pemain', 'pelatih', 'coach', 'latihan', 'jersey', 'fanbase', 'supporter', 'ultras',
];

function keywords(q?: ExpandedQuery): string[] {
  const set = new Set<string>(SPORT_TERMS);
  if (q) {
    for (const t of [q.sport, q.targetType, ...q.synonyms, ...(q.hashtags ?? [])]) {
      if (t) set.add(t.replace(/^#/, '').toLowerCase());
    }
  }
  return [...set].filter(Boolean);
}

// Lapis 2: kaku, tanpa AI. Maps/OSM dipercaya (listing bisnis).
export function isRelevant(c: Candidate, q?: ExpandedQuery): boolean {
  if (c.source === 'google-maps' || c.source === 'osm') return true;

  const text = [c.name, c.handle, c.bio, c.website].filter(Boolean).join(' \n ').toLowerCase();
  if (!text.trim()) return false;

  if (keywords(q).some((k) => text.includes(k))) return true;

  // Lemah: cocok kota + punya nomor.
  if (q?.city && text.includes(q.city.toLowerCase()) && c.phone) return true;
  return false;
}
