import express from 'express';
import { config } from '../config.ts';
import { db, getScore, setSuggestedMessage, markContacted } from '../db/index.ts';
import { draftMessage } from '../outreach/draft.ts';
import { leadsToCsv } from '../export/csv.ts';
import { leadsPage } from './views.ts';

const app = express();
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  const filter = String(req.query.filter ?? '');
  const sql = `SELECT l.*, s.score, s.reason, s.segment FROM leads l
       LEFT JOIN scores s ON s.lead_id = l.id
       ${filter === 'new' ? 'WHERE l.contacted_at IS NULL AND l.phone IS NOT NULL' : ''}
       ORDER BY COALESCE(s.score,0) DESC, l.id DESC LIMIT 500`;
  const rows = db.prepare(sql).all() as unknown as Array<Record<string, unknown>>;
  res.send(leadsPage(rows as never, filter));
});

app.post('/draft', async (req, res) => {
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

app.get('/export.csv', (_req, res) => {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename=leads.csv');
  res.send(leadsToCsv(config.minScore));
});

app.listen(config.port, () => {
  console.log(`dashboard: http://localhost:${config.port}`);
});
