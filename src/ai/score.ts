import { config, hasAI } from '../config.ts';
import type { LeadRecord, LeadScore } from '../types.ts';
import { chatJSON } from './client.ts';
import { templateFor } from '../outreach/templates.ts';

const BATCH = 8;

const TEAM_WORDS = ['ssb', 'akademi', 'klub', 'klub', 'tim', 'komunitas', 'sekolah', 'pembinaan', 'futsal', 'sepakbola', 'sepak bola'];

export function heuristicScore(lead: LeadRecord): LeadScore {
  let score = 30;
  const bio = (lead.bio ?? '').toLowerCase();
  const meta = lead.meta ? safeMeta(lead.meta) : {};
  if (lead.phone) score += 30;
  if (lead.email) score += 5;
  if (lead.website) score += 5;
  if (TEAM_WORDS.some((w) => bio.includes(w))) score += 15;
  if (typeof meta.followers === 'number' && meta.followers > 200) score += 10;
  if (typeof meta.posts === 'number' && meta.posts > 10) score += 5;
  score = Math.max(0, Math.min(100, score));
  return {
    id: lead.id,
    score,
    reason: 'heuristic (tanpa AI)',
    segment: 'umum',
    templateId: templateFor('t_umum').id,
  };
}

function safeMeta(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function compact(lead: LeadRecord): Record<string, unknown> {
  return {
    id: lead.id,
    name: lead.name,
    source: lead.source,
    city: lead.city,
    hasPhone: !!lead.phone,
    bio: (lead.bio ?? '').slice(0, 400),
  };
}

export async function scoreLeads(leads: LeadRecord[]): Promise<{ scores: LeadScore[]; model: string }> {
  if (!hasAI) return { scores: leads.map(heuristicScore), model: 'heuristic' };

  const system = [
    `Kamu menilai lead untuk penawaran: ${config.offer}.`,
    'Nilai 0-100 seberapa cocok lead jadi pembeli. Sinyal: ini benar-benar tim/klub/akademi aktif, ada kontak, bukti aktivitas.',
    'templateId pilih satu: t_jersey | t_alat | t_sponsor | t_umum.',
    'Balas HANYA JSON: {"results":[{"id":number,"score":number,"reason":string,"segment":string,"templateId":string}]}.',
    'reason maksimal 12 kata Bahasa Indonesia.',
  ].join(' ');

  const scores: LeadScore[] = [];
  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    try {
      const out = await chatJSON<{ results?: LeadScore[] }>(system, JSON.stringify(batch.map(compact)));
      for (const lead of batch) {
        const hit = out.results?.find((r) => Number(r.id) === lead.id);
        scores.push(
          hit
            ? {
                id: lead.id,
                score: Math.max(0, Math.min(100, Number(hit.score) || 0)),
                reason: hit.reason ?? '',
                segment: hit.segment ?? 'umum',
                templateId: templateFor(hit.templateId).id,
              }
            : heuristicScore(lead),
        );
      }
    } catch (err) {
      console.warn(`[ai] skor batch gagal, heuristic: ${(err as Error).message}`);
      scores.push(...batch.map(heuristicScore));
    }
  }
  return { scores, model: config.ai.model };
}
