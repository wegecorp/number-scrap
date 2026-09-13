import type { Candidate, LeadRecord } from '../types.ts';
import { db, deleteLead, addRejected } from '../db/index.ts';
import { candidateKey } from '../ai/relevance.ts';
import { isBadCandidate, loadBlocklist } from './blocklist.ts';
import { filterCandidates } from './index.ts';

export type CleanItem = { id: number; name: string; source: string; reason: string };

function rowsFor(campaignId?: number | null): LeadRecord[] {
  if (campaignId) {
    return db.prepare('SELECT * FROM leads WHERE campaign_id = ?').all(campaignId) as unknown as LeadRecord[];
  }
  return db.prepare('SELECT * FROM leads').all() as unknown as LeadRecord[];
}

/** Hitung lead yang layak dibuang. `ai:true` ikut menjalankan lapis relevansi/AI. */
export async function previewClean(opts: { campaignId?: number | null; ai?: boolean } = {}): Promise<CleanItem[]> {
  const rows = rowsFor(opts.campaignId);
  const bl = loadBlocklist(undefined, true);
  const out: CleanItem[] = [];
  const cands: Candidate[] = [];
  const byKey = new Map<string, LeadRecord>();

  for (const r of rows) {
    if (isBadCandidate({ name: r.name, bio: r.bio, website: r.website, url: r.url, handle: r.handle }, bl)) {
      out.push({ id: r.id, name: r.name, source: r.source, reason: 'blocklist' });
      continue;
    }
    const c: Candidate = {
      source: r.source,
      handle: r.handle ?? undefined,
      name: r.name,
      city: r.city ?? undefined,
      bio: r.bio ?? undefined,
      website: r.website ?? undefined,
      url: r.url ?? undefined,
      phone: r.phone ?? undefined,
    };
    cands.push(c);
    byKey.set(candidateKey(c), r);
  }

  if (opts.ai) {
    const { dropped } = await filterCandidates(cands, undefined, { ai: true });
    for (const d of dropped) {
      const r = byKey.get(d.key);
      if (r) out.push({ id: r.id, name: r.name, source: r.source, reason: d.reason });
    }
  }

  return out;
}

export function applyClean(items: CleanItem[]): number {
  for (const it of items) deleteLead(it.id);
  addRejected(items.map((i) => ({ key: String(i.id), name: i.name, source: i.source, reason: `clean:${i.reason}` })));
  return items.length;
}
