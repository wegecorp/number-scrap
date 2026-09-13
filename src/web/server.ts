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
import { leadsToCsv } from '../export/csv.ts';
import { leadsPage, runPage, type LeadsViewOpts } from './views.ts';
import { runPipeline } from '../pipeline.ts';

const JOB_LOG = 'data/job.log';

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

function readLog(): string {
  try {
    return readFileSync(JOB_LOG, 'utf8').split('\n').slice(-200).join('\n');
  } catch {
    return '';
  }
}

function baseOpts(): LeadsViewOpts {
  return {
    campaigns: listCampaigns(),
    sources: ['instagram', 'google-maps', 'osm', 'website', 'forum'],
    filters: { q: '', source: '', minScore: 0, onlyNew: false, campaign: '' },
    running: runningJob() ?? null,
    jobLog: readLog(),
  };
}

app.get('/', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const source = String(req.query.source ?? '').trim();
  const minScore = Number(req.query.min_score ?? 0) || 0;
  const onlyNew = req.query.new === '1';
  const campaign = String(req.query.campaign ?? '').trim();

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q) {
    where.push('(l.name LIKE ? OR l.handle LIKE ? OR l.phone LIKE ? OR l.city LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (source) {
    where.push('l.source = ?');
    params.push(source);
  }
  if (minScore) {
    where.push('COALESCE(s.score,0) >= ?');
    params.push(minScore);
  }
  if (onlyNew) where.push('l.contacted_at IS NULL AND l.phone IS NOT NULL');
  if (campaign) {
    where.push('l.campaign_id = ?');
    params.push(Number(campaign));
  }

  const sql = `SELECT l.*, s.score, s.reason, s.segment, c.keyword AS campaign FROM leads l
    LEFT JOIN scores s ON s.lead_id = l.id
    LEFT JOIN campaigns c ON c.id = l.campaign_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(s.score,0) DESC, l.id DESC LIMIT 500`;
  const rows = db.prepare(sql).all(...params) as unknown as Array<Record<string, unknown>>;

  const opts = baseOpts();
  opts.filters = { q, source, minScore, onlyNew, campaign };
  res.send(leadsPage(rows as never, opts));
});

app.get('/run', (_req, res) => {
  res.send(runPage(baseOpts()));
});

app.post('/run', (req, res) => {
  if (runningJob()) return res.redirect('/run');
  const keywords = String(req.body.keywords ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
  const limit = Number(req.body.limit) || 20;
  if (!keywords.length) return res.redirect('/run');

  writeFileSync(JOB_LOG, '');
  const jobId = createJob(`discover+score+draft (${keywords.length} keyword, limit ${limit})`, JOB_LOG);
  const log = (line: string): void => appendFileSync(JOB_LOG, line + '\n');

  res.redirect('/run');
  void (async () => {
    try {
      await runPipeline(keywords, limit, log);
      finishJob(jobId, 0, 'done');
    } catch (err) {
      log(`[run] GAGAL: ${(err as Error).message}`);
      finishJob(jobId, 1, 'failed');
    }
  })();
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
  if (req.body.id) markContacted(Number(req.body.id));
  res.redirect(req.get('referer') ?? '/');
});

app.post('/delete', (req, res) => {
  if (req.body.id) deleteLead(Number(req.body.id));
  res.redirect(req.get('referer') ?? '/');
});

app.post('/block', (req, res) => {
  const lead = getLead(Number(req.body.id));
  if (lead) {
    const target = blockTargetForLead({ website: lead.website, handle: lead.handle, name: lead.name });
    if (target) appendBlocklist(target);
    deleteLead(lead.id);
  }
  res.redirect(req.get('referer') ?? '/');
});

app.get('/export.csv', (_req, res) => {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename=leads.csv');
  res.send(leadsToCsv(config.minScore));
});

app.listen(config.port, config.host, () => {
  console.log(`dashboard: http://${config.host}:${config.port}`);
});
