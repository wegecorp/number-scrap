import express from 'express';
import { config } from '../config.ts';
import { db, getLead, getScore, createMessage, hasMessage, isSuppressed, listMessages, approveMessage, approveAllDrafts } from '../db/index.ts';
import { draftMessage } from '../outreach/draft.ts';
import { leadsToCsv } from '../export/csv.ts';
import { leadsPage, messagesPage, repliesPage } from './views.ts';

const app = express();
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT l.*, s.score, s.reason, s.segment FROM leads l
       LEFT JOIN scores s ON s.lead_id = l.id
       ORDER BY COALESCE(s.score,0) DESC, l.id DESC LIMIT 500`,
    )
    .all() as unknown as Array<Record<string, unknown>>;
  res.send(leadsPage(rows as never));
});

app.post('/draft', async (req, res) => {
  const ids: number[] = ([] as unknown[]).concat(req.body.ids ?? []).map(Number).filter((n) => Number.isFinite(n));
  let made = 0;
  for (const id of ids) {
    const lead = getLead(id);
    if (!lead || isSuppressed(lead.phone) || hasMessage(id)) continue;
    const s = getScore(id);
    if ((s?.score ?? 0) < config.minScore) continue;
    const body = await draftMessage(lead, s?.template_id);
    createMessage(id, body);
    made++;
  }
  res.redirect(made ? '/messages' : '/');
});

app.get('/messages', (_req, res) => {
  res.send(messagesPage(listMessages()));
});

app.post('/approve', (req, res) => {
  if (req.body.all) {
    const n = approveAllDrafts(config.minScore);
    console.log(`[web] approve semua: ${n}`);
  } else if (req.body.id) {
    approveMessage(Number(req.body.id));
  }
  res.redirect('/messages');
});

app.get('/replies', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.from_jid, r.body, r.is_optout, r.created_at, l.name FROM replies r
       LEFT JOIN leads l ON l.id = r.lead_id ORDER BY r.id DESC LIMIT 500`,
    )
    .all() as unknown as Array<{ id: number; from_jid: string; body: string; is_optout: number; created_at: string; name: string | null }>;
  res.send(repliesPage(rows));
});

app.get('/export.csv', (_req, res) => {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename=leads.csv');
  res.send(leadsToCsv(config.minScore));
});

app.listen(config.port, () => {
  console.log(`dashboard: http://localhost:${config.port}`);
});
