import { config, hasAI } from '../config.ts';
import type { Candidate, ExpandedQuery } from '../types.ts';
import { chatJSON } from './client.ts';

const BATCH = 10;

export function candidateKey(c: Candidate): string {
  return c.phone ?? `${c.source}:${c.handle ?? c.name}`;
}

export async function classifyRelevance(
  cands: Candidate[],
  q?: ExpandedQuery,
): Promise<Map<string, { relevant: boolean; spam: boolean; reason: string }>> {
  const map = new Map<string, { relevant: boolean; spam: boolean; reason: string }>();
  if (!hasAI || !cands.length) return map;

  const system = [
    `Nilailah kandidat lead untuk penawaran: ${config.offer}.`,
    'relevant = benar-benar tim/klub/akademi/komunitas olahraga (bukan individu tak terkait).',
    'spam = konten dewasa, judi, pinjol, atau promosi tidak relevan.',
    'Balas HANYA JSON: {"results":[{"key":string,"relevant":boolean,"spam":boolean,"reason":string}]}.',
    'reason maksimal 10 kata Bahasa Indonesia.',
  ].join(' ');

  for (let i = 0; i < cands.length; i += BATCH) {
    const batch = cands.slice(i, i + BATCH);
    const payload = batch.map((c) => ({
      key: candidateKey(c),
      nama: c.name,
      sumber: c.source,
      kota: c.city,
      bio: (c.bio ?? '').slice(0, 200),
      web: c.website,
    }));
    try {
      const out = await chatJSON<{
        results?: Array<{ key?: string; relevant?: boolean; spam?: boolean; reason?: string }>;
      }>(system, JSON.stringify(payload));
      for (const r of out.results ?? []) {
        if (typeof r.key === 'string') {
          map.set(r.key, { relevant: r.relevant !== false, spam: !!r.spam, reason: r.reason ?? '' });
        }
      }
    } catch (err) {
      console.warn(`[ai] relevance gagal: ${(err as Error).message}`);
    }
  }
  return map;
}
