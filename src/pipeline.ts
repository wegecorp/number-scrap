import type { Candidate, ExpandedQuery } from './types.ts';
import {
  db,
  upsertLead,
  listLeads,
  saveScore,
  setSuggestedMessage,
  createCampaign,
  setCampaignLeadCount,
  addRejected,
} from './db/index.ts';
import { expandQuery } from './ai/expand.ts';
import { scoreLeads } from './ai/score.ts';
import { filterCandidates } from './filter/index.ts';
import { discover } from './discovery/index.ts';
import { enrichContact } from './enrich/index.ts';
import { draftMessage } from './outreach/draft.ts';
import { config } from './config.ts';

export type Logger = (line: string) => void;
const consoleLogger: Logger = (line) => console.log(line);

/** Jalankan discovery untuk satu query yang sudah jadi (tanpa expand AI). */
export async function runDiscoverQuery(
  q: ExpandedQuery,
  limit: number | undefined,
  log: Logger,
  label: string,
): Promise<number> {
  const campaignId = createCampaign(label.slice(0, 60), label, q);

  const candidates = await discover(q, { limit });
  log(`[discover] kandidat: ${candidates.length}`);

  const enriched: Candidate[] = [];
  for (const c of candidates) {
    const contact = await enrichContact(c);
    enriched.push({
      ...c,
      phone: c.phone ?? contact.phones[0],
      email: c.email ?? contact.emails[0],
      meta: { ...(c.meta ?? {}), extraPhones: contact.phones.length > 1 ? contact.phones : undefined },
    });
  }

  const { kept, dropped } = await filterCandidates(enriched, q);
  if (dropped.length) {
    addRejected(dropped.map((d) => ({ key: d.key, name: d.name, reason: d.reason })));
    const sample = dropped.slice(0, 3).map((d) => `${d.name} (${d.reason})`).join('; ');
    log(`[filter] dibuang ${dropped.length}${sample ? `: ${sample}${dropped.length > 3 ? ' ...' : ''}` : ''}`);
  }
  log(`[filter] lolos: ${kept.length}`);

  const seen = new Set<number>();
  for (const c of kept) {
    const id = upsertLead(c, campaignId);
    if (c.meta?.extraPhones) {
      db.prepare("UPDATE leads SET meta = json_set(COALESCE(meta,'{}'), '$.extraContacts', ?) WHERE id = ?").run(
        JSON.stringify({ phones: c.meta.extraPhones }),
        id,
      );
    }
    seen.add(id);
  }
  setCampaignLeadCount(campaignId, seen.size);
  log(`[discover] tersimpan: ${seen.size} (campaign #${campaignId})`);
  log(`[discover] total lead punya nomor: ${listLeads({ withPhone: true }).length}`);
  return campaignId;
}

export async function runDiscover(intent: string, limit?: number, log: Logger = consoleLogger): Promise<number> {
  const q = await expandQuery(intent);
  if (q.tooBroad) {
    log('! Intent terlalu luas. Tambahkan tipe target + kota, contoh: "SSB Bandung".');
    return 0;
  }
  return runDiscoverQuery(q, limit, log, intent);
}

export async function runScore(log: Logger = consoleLogger): Promise<void> {
  const leads = listLeads({ withPhone: true, unscored: true });
  if (!leads.length) {
    log('tidak ada lead baru untuk diskor');
    return;
  }
  log(`[score] menilai ${leads.length} lead...`);
  const { scores, model } = await scoreLeads(leads);
  for (const s of scores) saveScore(s, model);
  log(`[score] selesai (model: ${model})`);
}

export async function runDraft(log: Logger = consoleLogger): Promise<void> {
  const leads = db
    .prepare(
      `SELECT l.* FROM leads l LEFT JOIN scores s ON s.lead_id = l.id
       WHERE l.phone IS NOT NULL AND l.suggested_message IS NULL AND COALESCE(s.score,0) >= ?
       ORDER BY COALESCE(s.score,0) DESC`,
    )
    .all(config.minScore) as unknown as Array<Parameters<typeof draftMessage>[0]>;
  if (!leads.length) {
    log('tidak ada lead yang perlu pesan');
    return;
  }
  let made = 0;
  for (const lead of leads) {
    setSuggestedMessage(lead.id, draftMessage(lead));
    made++;
  }
  log(`[draft] pesan disusun: ${made}`);
}

/** Setiap term = satu campaign, memakai frasa persis (tanpa expand AI lagi). */
export async function runPipelineFromTerms(terms: string[], limit: number, log: Logger = consoleLogger): Promise<number[]> {
  const clean = terms.map((t) => t.trim()).filter((t) => t && !t.startsWith('#'));
  const campaignIds: number[] = [];
  log(`[run] ${clean.length} keyword, limit ${limit}`);
  for (let i = 0; i < clean.length; i++) {
    const term = clean[i];
    log(`\n[run] (${i + 1}/${clean.length}) ${term}`);
    const q: ExpandedQuery = {
      sport: '',
      targetType: '',
      city: '',
      googleQueries: [`site:instagram.com ${term}`],
      hashtags: [],
      synonyms: [term],
      searchPhrases: [term],
    };
    const cid = await runDiscoverQuery(q, limit, log, term);
    campaignIds.push(cid);
    log(`[run] ${term}: selesai`);
  }
  await runScore(log);
  await runDraft(log);
  log('[run] selesai');
  return campaignIds;
}

export async function runPipeline(keywords: string[], limit: number, log: Logger = consoleLogger): Promise<void> {
  const clean = keywords.map((k) => k.trim()).filter((k) => k && !k.startsWith('#'));
  log(`[run] ${clean.length} keyword, limit ${limit}`);
  for (let i = 0; i < clean.length; i++) {
    log(`\n[run] (${i + 1}/${clean.length}) ${clean[i]}`);
    await runDiscover(clean[i], limit, log);
  }
  await runScore(log);
  await runDraft(log);
  log('[run] selesai');
}
