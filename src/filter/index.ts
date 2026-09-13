import { hasAI } from '../config.ts';
import type { Candidate, ExpandedQuery } from '../types.ts';
import { classifyRelevance, candidateKey } from '../ai/relevance.ts';
import { isBadCandidate, loadBlocklist } from './blocklist.ts';
import { isRelevant } from './relevance.ts';

export type Dropped = { key: string; name: string; reason: string };
export type FilterOutcome = { kept: Candidate[]; dropped: Dropped[] };

/**
 * Lapis 1 bloklist (kaku) -> lapis 2 relevansi (kaku) -> lapis 3 AI (ambigu + deteksi spam).
 * AI tidak pernah membuang kandidat yang sudah lolos relevansi kaku, kecuali ditandai spam.
 */
export async function filterCandidates(
  cands: Candidate[],
  q?: ExpandedQuery,
  opts: { ai?: boolean } = {},
): Promise<FilterOutcome> {
  const bl = loadBlocklist();
  const kept: Candidate[] = [];
  const dropped: Dropped[] = [];
  const uncertain: Candidate[] = [];

  for (const c of cands) {
    if (isBadCandidate(c, bl)) {
      dropped.push({ key: candidateKey(c), name: c.name, reason: 'blocklist' });
      continue;
    }
    if (isRelevant(c, q)) kept.push(c);
    else uncertain.push(c);
  }

  const useAI = hasAI && (opts.ai ?? true);
  if (!useAI) {
    for (const c of uncertain) dropped.push({ key: candidateKey(c), name: c.name, reason: 'tidak relevan' });
    return { kept, dropped };
  }

  // AI menilai semuanya: spam dibuang; relevance AI hanya mengikat untuk yang ambigu.
  const verdicts = await classifyRelevance([...kept, ...uncertain], q);

  const finalKept: Candidate[] = [];
  for (const c of kept) {
    const v = verdicts.get(candidateKey(c));
    if (v?.spam) dropped.push({ key: candidateKey(c), name: c.name, reason: `ai:spam (${v.reason})` });
    else finalKept.push(c);
  }
  for (const c of uncertain) {
    const v = verdicts.get(candidateKey(c));
    if (!v) dropped.push({ key: candidateKey(c), name: c.name, reason: 'ai:tak dinilai' });
    else if (v.spam) dropped.push({ key: candidateKey(c), name: c.name, reason: `ai:spam (${v.reason})` });
    else if (!v.relevant) dropped.push({ key: candidateKey(c), name: c.name, reason: `ai:tidak relevan (${v.reason})` });
    else finalKept.push(c);
  }

  return { kept: finalKept, dropped };
}
