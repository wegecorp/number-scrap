import { hasAI } from '../config.ts';
import type { ExpandedQuery } from '../types.ts';
import { chatJSON } from './client.ts';

const CITIES = [
  'jakarta', 'jakarta selatan', 'jakarta utara', 'jakarta barat', 'jakarta timur', 'jakarta pusat',
  'bandung', 'surabaya', 'medan', 'semarang', 'makassar', 'bekasi', 'depok', 'tangerang', 'bogor',
  'yogyakarta', 'solo', 'malang', 'denpasar', 'palembang', 'pekanbaru', 'balikpapan', 'samarinda',
];
const SPORTS = ['sepak bola', 'sepakbola', 'futsal', 'basket', 'voli', 'badminton', 'bulu tangkis', 'renang', 'atletik', 'esport', 'panahan', 'tenis'];
const TYPES = ['ssb', 'sekolah sepak bola', 'akademi', 'klub', 'tim', 'komunitas', 'turnamen', 'liga'];

export function heuristicExpand(intent: string): ExpandedQuery {
  const lower = intent.toLowerCase();
  const city = CITIES.find((c) => lower.includes(c)) ?? '';
  const sport = SPORTS.find((s) => lower.includes(s)) ?? '';
  const targetType = TYPES.find((t) => lower.includes(t)) ?? '';
  const key = [targetType, sport].filter(Boolean).join(' ').trim();
  const cityPart = city ? ` ${city}` : '';
  const tooBroad = !targetType || !city;

  const googleQueries: string[] = [];
  if (key) googleQueries.push(`site:instagram.com "${key}"${cityPart}`);
  if (sport && sport !== key) googleQueries.push(`site:instagram.com "${sport}"${cityPart}`);
  googleQueries.push(`site:instagram.com "${targetType || sport || 'tim olahraga'}"${cityPart}`);
  if (city) googleQueries.push(`"${key || sport || 'klub olahraga'}"${cityPart} kontak instagram`);

  const slug = city.replace(/\s+/g, '');
  const hashtags = [...new Set([targetType, sport].filter(Boolean).map((w) => `#${w.replace(/\s+/g, '')}${slug}`))];

  return {
    sport,
    targetType,
    city,
    googleQueries: [...new Set(googleQueries)],
    hashtags,
    synonyms: [targetType, sport, 'klub', 'akademi', 'komunitas'].filter(Boolean),
    tooBroad,
  };
}

export async function expandQuery(intent: string): Promise<ExpandedQuery> {
  if (!hasAI) return heuristicExpand(intent);
  const system = [
    'Kamu merancang query pencarian lead tim/klub olahraga Indonesia di Instagram & Google Maps.',
    'Balas HANYA JSON: {"sport":string,"targetType":string,"city":string,"googleQueries":string[],"hashtags":string[],"synonyms":string[],"tooBroad":boolean}.',
    'googleQueries = query untuk Google penemuan akun Instagram, WAJIB pakai "site:instagram.com" plus istilah Indonesia (ssb, klub, akademi, komunitas, turnamen).',
    'Jika intent terlalu luas (kurang tipe target ATAU kurang kota), set tooBroad=true.',
  ].join(' ');
  try {
    const q = await chatJSON<ExpandedQuery>(system, intent);
    return {
      sport: q.sport ?? '',
      targetType: q.targetType ?? '',
      city: q.city ?? '',
      googleQueries: Array.isArray(q.googleQueries) && q.googleQueries.length ? q.googleQueries : heuristicExpand(intent).googleQueries,
      hashtags: Array.isArray(q.hashtags) ? q.hashtags : [],
      synonyms: Array.isArray(q.synonyms) ? q.synonyms : [],
      tooBroad: !!q.tooBroad,
    };
  } catch (err) {
    console.warn(`[ai] expand gagal, pakai heuristic: ${(err as Error).message}`);
    return heuristicExpand(intent);
  }
}
