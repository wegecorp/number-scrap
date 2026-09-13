import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { config } from '../config.ts';
import {
  db,
  getLead,
  getScore,
  setSuggestedMessage,
  markContacted,
  deleteLead,
  listCampaigns,
  createJob,
  finishJob,
  runningJob,
} from '../db/index.ts';
import { draftMessage } from '../outreach/draft.ts';
import { appendBlocklist, blockTargetForLead } from '../filter/blocklist.ts';
import { previewClean, applyClean, type CleanItem } from '../filter/clean.ts';
import { expandQuery } from '../ai/expand.ts';
import { searchTerms } from '../discovery/index.ts';
import { leadsToCsv } from '../export/csv.ts';
import {
  leadsPage,
  pipelinePage,
  cleanPage,
  campaignsPage,
  blocklistPage,
  rejectedPage,
  statsPage,
  type PageOpts,
  type Filters,
} from './views.ts';
import { runPipelineFromTerms } from '../pipeline.ts';

const JOB_LOG = 'data/job.log';
const BLOCKLIST_FILE = 'blocklist.txt';

const app = express();
app.use(express.urlencoded({ extended: true }));

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

if (config.dashUser && config.dashPass) {
  app.use((req, res, next) => {
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
      if (user !== undefined && pass !== undefined && safeEqual(user, config.dashUser) && safeEqual(pass, config.dashPass)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="number-scrap"');
    res.status(401).send('Auth required');
  });
  console.log('[web] basic auth aktif');
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return v === undefined ? [] : [String(v)];
}

function readLog(): string {
  try {
    return readFileSync(JOB_LOG, 'utf8').split('\n').slice(-200).join('\n');
  } catch {
    return '';
  }
}

function filtersFrom(req: express.Request): Filters {
  return {
    q: String(req.query.q ?? '').trim(),
    source: String(req.query.source ?? '').trim(),
    minScore: Number(req.query.min_score ?? 0) || 0,
    onlyNew: req.query.new === '1',
    campaign: String(req.query.campaign ?? '').trim(),
  };
}

function baseOpts(): PageOpts {
  return {
    campaigns: listCampaigns(),
    sources: ['instagram', 'google-maps', 'osm', 'website', 'forum'],
    filters: { q: '', source: '', minScore: 0, onlyNew: false, campaign: '' },
    running: runningJob() ?? null,
    jobLog: readLog(),
  };
}

app.get('/', (req, res) => {
  const f = filtersFrom(req);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (f.q) {
    where.push('(l.name LIKE ? OR l.handle LIKE ? OR l.phone LIKE ? OR l.city LIKE ?)');
    const like = `%${f.q}%`;
    params.push(like, like, like, like);
  }
  if (f.source) {
    where.push('l.source = ?');
    params.push(f.source);
  }
  if (f.minScore) {
    where.push('COALESCE(s.score,0) >= ?');
    params.push(f.minScore);
  }
  if (f.onlyNew) where.push('l.contacted_at IS NULL AND l.phone IS NOT NULL');
  if (f.campaign) {
    where.push('l.campaign_id = ?');
    params.push(Number(f.campaign));
  }

  const sql = `SELECT l.*, s.score, s.reason, s.segment, c.keyword AS campaign FROM leads l
    LEFT JOIN scores s ON s.lead_id = l.id
    LEFT JOIN campaigns c ON c.id = l.campaign_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(s.score,0) DESC, l.id DESC LIMIT 500`;
  const rows = db.prepare(sql).all(...params) as unknown as Array<Record<string, unknown>>;

  const opts = baseOpts();
  opts.filters = f;
  opts.flash = String(req.query.flash ?? '') || undefined;
  res.send(leadsPage(rows as never, opts));
});

app.get('/pipeline', (_req, res) => {
  res.send(pipelinePage({ ...baseOpts(), seeds: '', suggestions: [] }));
});

app.post('/suggest', async (req, res) => {
  const seeds = String(req.body.seeds ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const suggestions = [];
  for (const seed of seeds) {
    const q = await expandQuery(seed);
    suggestions.push({ seed, terms: searchTerms(q), city: q.city, targetType: q.targetType, tooBroad: !!q.tooBroad });
  }
  res.send(pipelinePage({ ...baseOpts(), seeds: seeds.join('\n'), suggestions }));
});

app.post('/run', (req, res) => {
  if (runningJob()) return res.redirect('/pipeline');
  const terms = String(req.body.terms ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
  const limit = Number(req.body.limit) || 20;
  if (!terms.length) return res.redirect('/pipeline');

  writeFileSync(JOB_LOG, '');
  const jobId = createJob(`pipeline (${terms.length} frasa, limit ${limit})`, JOB_LOG);
  const log = (line: string): void => appendFileSync(JOB_LOG, line + '\n');

  res.redirect('/pipeline');
  void (async () => {
    try {
      await runPipelineFromTerms(terms, limit, log);
      finishJob(jobId, 0, 'done');
    } catch (err) {
      log(`[run] GAGAL: ${(err as Error).message}`);
      finishJob(jobId, 1, 'failed');
    }
  })();
});

app.post('/clean', async (req, res) => {
  const campaignId = req.body.campaign ? Number(req.body.campaign) : null;
  const ai = req.body.ai === '1';
  const items = await previewClean({ campaignId, ai });
  res.send(cleanPage(items, { ...baseOpts(), campaignId: campaignId ? String(campaignId) : '' }));
});

app.post('/clean/apply', (req, res) => {
  const ids = asArray(req.body.id);
  const names = asArray(req.body.name);
  const reasons = asArray(req.body.reason);
  const items: CleanItem[] = ids.map((id, i) => ({
    id: Number(id),
    name: names[i] ?? '',
    source: '',
    reason: reasons[i] ?? 'dashboard',
  }));
  const deleted = applyClean(items);
  res.redirect(`/?flash=${encodeURIComponent(`Bersihkan: ${deleted} lead dihapus`)}`);
});

app.post('/draft', async (_req, res) => {
  const leads = db
    .prepare(
      `SELECT l.* FROM leads l LEFT JOIN scores s ON s.lead_id = l.id
       WHERE l.phone IS NOT NULL AND l.suggested_message IS NULL AND COALESCE(s.score,0) >= ?
       ORDER BY COALESCE(s.score,0) DESC LIMIT 50`,
    )
    .all(config.minScore) as unknown as Array<Parameters<typeof draftMessage>[0]>;
  for (const lead of leads) {
    const s = getScore(lead.id);
    const body = await draftMessage(lead, s?.template_id);
    setSuggestedMessage(lead.id, body);
  }
  console.log(`[web] susun pesan: ${leads.length}`);
  res.redirect('/');
});

app.post('/contacted', (req, res) => {
  for (const id of asArray(req.body.id)) markContacted(Number(id));
  res.redirect(req.get('referer') ?? '/');
});

app.post('/delete', (req, res) => {
  for (const id of asArray(req.body.id)) deleteLead(Number(id));
  res.redirect(req.get('referer') ?? '/');
});

app.post('/block', (req, res) => {
  for (const id of asArray(req.body.id)) {
    const lead = getLead(Number(id));
    if (!lead) continue;
    const target = blockTargetForLead({ website: lead.website, handle: lead.handle, name: lead.name });
    if (target) appendBlocklist(target);
    deleteLead(lead.id);
  }
  res.redirect(req.get('referer') ?? '/');
});

app.post('/bulk', (req, res) => {
  const ids = asArray(req.body.ids).map(Number).filter((n) => Number.isFinite(n));
  const action = String(req.body.action ?? '');
  if (action === 'contacted') for (const id of ids) markContacted(id);
  if (action === 'delete') for (const id of ids) deleteLead(id);
  if (action === 'block') {
    for (const id of ids) {
      const lead = getLead(id);
      if (!lead) continue;
      const target = blockTargetForLead({ website: lead.website, handle: lead.handle, name: lead.name });
      if (target) appendBlocklist(target);
      deleteLead(id);
    }
  }
  res.redirect(req.get('referer') ?? '/');
});

app.get('/campaigns', (_req, res) => {
  res.send(campaignsPage(listCampaigns(), baseOpts()));
});

app.post('/campaigns/delete', (req, res) => {
  const id = Number(req.body.id);
  if (Number.isFinite(id)) {
    db.prepare('DELETE FROM scores WHERE lead_id IN (SELECT id FROM leads WHERE campaign_id=?)').run(id);
    db.prepare('DELETE FROM leads WHERE campaign_id=?').run(id);
    db.prepare('DELETE FROM campaigns WHERE id=?').run(id);
  }
  res.redirect('/campaigns');
});

app.get('/blocklist', (_req, res) => {
  res.send(blocklistPage(readBlocklistLines(), baseOpts()));
});

app.post('/blocklist/add', (req, res) => {
  const value = String(req.body.value ?? '').trim();
  if (value) appendBlocklist(value);
  res.redirect('/blocklist');
});

app.get('/rejected', (_req, res) => {
  const rows = db
    .prepare('SELECT id, name, source, reason, created_at FROM rejected ORDER BY id DESC LIMIT 500')
    .all() as unknown as Array<{ id: number; name: string | null; source: string | null; reason: string | null; created_at: string }>;
  res.send(rejectedPage(rows, baseOpts()));
});

app.get('/stats', (_req, res) => {
  const n = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  const stats = {
    leads: n('SELECT COUNT(*) n FROM leads'),
    withPhone: n('SELECT COUNT(*) n FROM leads WHERE phone IS NOT NULL'),
    scored: n('SELECT COUNT(*) n FROM scores'),
    contacted: n('SELECT COUNT(*) n FROM leads WHERE contacted_at IS NOT NULL'),
    dnc: n('SELECT COUNT(*) n FROM suppression'),
    rejected: n('SELECT COUNT(*) n FROM rejected'),
    bySource: db.prepare('SELECT source, COUNT(*) n FROM leads GROUP BY source ORDER BY n DESC').all() as unknown as Array<{ source: string; n: number }>,
    byCampaign: db
      .prepare(
        `SELECT c.keyword, c.lead_count, (SELECT COUNT(*) FROM leads l WHERE l.campaign_id=c.id AND l.phone IS NOT NULL) AS withPhone
         FROM campaigns c ORDER BY c.id DESC LIMIT 50`,
      )
      .all() as unknown as Array<{ keyword: string; lead_count: number; withPhone: number }>,
  };
  res.send(statsPage(stats, baseOpts()));
});

app.get('/export.csv', (req, res) => {
  const f = filtersFrom(req);
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename=leads.csv');
  res.send(
    leadsToCsv(f.minScore, {
      uncontactedOnly: f.onlyNew,
      q: f.q || undefined,
      source: f.source || undefined,
      campaignId: f.campaign ? Number(f.campaign) : undefined,
    }),
  );
});

function readBlocklistLines(): string[] {
  try {
    return readFileSync(BLOCKLIST_FILE, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

app.listen(config.port, config.host, () => {
  console.log(`dashboard: http://${config.host}:${config.port}`);
});
