import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.ts';
import type { Candidate, LeadRecord, LeadScore } from '../types.ts';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  handle TEXT,
  name TEXT,
  city TEXT,
  bio TEXT,
  website TEXT,
  phone TEXT,
  raw_phone TEXT,
  email TEXT,
  url TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_src_handle ON leads(source, handle) WHERE handle IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT,
  keyword TEXT,
  query_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scores (
  lead_id INTEGER PRIMARY KEY REFERENCES leads(id),
  score INTEGER NOT NULL,
  reason TEXT,
  segment TEXT,
  template_id TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  campaign_id INTEGER,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS suppression (
  phone TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER,
  from_jid TEXT,
  body TEXT,
  is_optout INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function addColumnIfMissing(table: string, col: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
addColumnIfMissing('messages', 'error', 'TEXT');


export function upsertLead(c: Candidate): number {
  const existing = c.phone
    ? (db.prepare('SELECT id FROM leads WHERE phone = ?').get(c.phone) as { id: number } | undefined)
    : c.handle
      ? (db
          .prepare('SELECT id FROM leads WHERE source = ? AND handle = ?')
          .get(c.source, c.handle) as { id: number } | undefined)
      : undefined;
  const meta = c.meta ? JSON.stringify(c.meta) : null;

  if (existing) {
    db.prepare(
      `UPDATE leads SET name=COALESCE(?,name), city=COALESCE(?,city), bio=COALESCE(?,bio),
       website=COALESCE(?,website), phone=COALESCE(?,phone), raw_phone=COALESCE(?,raw_phone),
       email=COALESCE(?,email), url=COALESCE(?,url), meta=COALESCE(?,meta), updated_at=datetime('now')
       WHERE id=?`,
    ).run(c.name, c.city ?? null, c.bio ?? null, c.website ?? null, c.phone ?? null, c.rawPhone ?? null, c.email ?? null, c.url ?? null, meta, existing.id);
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO leads (source,handle,name,city,bio,website,phone,raw_phone,email,url,meta)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(c.source, c.handle ?? null, c.name, c.city ?? null, c.bio ?? null, c.website ?? null, c.phone ?? null, c.rawPhone ?? null, c.email ?? null, c.url ?? null, meta);
  return Number(info.lastInsertRowid);
}

export function listLeads(opts: { withPhone?: boolean; unscored?: boolean; minScore?: number } = {}): LeadRecord[] {
  const where: string[] = [];
  if (opts.withPhone) where.push('l.phone IS NOT NULL');
  if (opts.unscored) where.push('s.lead_id IS NULL');
  if (opts.minScore != null) where.push(`COALESCE(s.score, 0) >= ${Number(opts.minScore)}`);
  const sql = `SELECT l.* FROM leads l LEFT JOIN scores s ON s.lead_id = l.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(s.score,0) DESC, l.id DESC`;
  return db.prepare(sql).all() as unknown as LeadRecord[];
}

export function getLead(id: number): LeadRecord | undefined {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as unknown as LeadRecord | undefined;
}

export function saveScore(s: LeadScore, model: string): void {
  db.prepare(
    `INSERT INTO scores (lead_id,score,reason,segment,template_id,model) VALUES (?,?,?,?,?,?)
     ON CONFLICT(lead_id) DO UPDATE SET score=excluded.score, reason=excluded.reason,
     segment=excluded.segment, template_id=excluded.template_id, model=excluded.model`,
  ).run(s.id, s.score, s.reason, s.segment, s.templateId, model);
}

export function getScore(leadId: number): { score: number; reason: string | null; segment: string | null; template_id: string | null } | undefined {
  return db.prepare('SELECT score,reason,segment,template_id FROM scores WHERE lead_id = ?').get(leadId) as
    | { score: number; reason: string | null; segment: string | null; template_id: string | null }
    | undefined;
}

export function isSuppressed(phone: string | null): boolean {
  if (!phone) return false;
  return !!db.prepare('SELECT 1 FROM suppression WHERE phone = ?').get(phone);
}

export function createMessage(leadId: number, body: string, campaignId: number | null = null): number {
  const info = db
    .prepare('INSERT INTO messages (lead_id, campaign_id, body) VALUES (?,?,?)')
    .run(leadId, campaignId, body);
  return Number(info.lastInsertRowid);
}

export function hasMessage(leadId: number): boolean {
  return !!db.prepare("SELECT 1 FROM messages WHERE lead_id = ? AND status IN ('draft','approved','sent')").get(leadId);
}

export type PendingMessage = {
  id: number;
  lead_id: number;
  body: string;
  name: string | null;
  phone: string | null;
};

export function approvedMessages(limit = 10): PendingMessage[] {
  return db
    .prepare(
      `SELECT m.id, m.lead_id, m.body, l.name, l.phone FROM messages m
       JOIN leads l ON l.id = m.lead_id
       WHERE m.status = 'approved' AND l.phone IS NOT NULL
       ORDER BY m.id ASC LIMIT ?`,
    )
    .all(limit) as unknown as PendingMessage[];
}

export function markSent(id: number): void {
  db.prepare("UPDATE messages SET status='sent', sent_at=datetime('now') WHERE id=?").run(id);
}

export function markFailed(id: number, error: string): void {
  db.prepare("UPDATE messages SET status='failed', error=? WHERE id=?").run(error.slice(0, 200), id);
}

export function approveMessage(id: number): void {
  db.prepare("UPDATE messages SET status='approved', approved_at=datetime('now') WHERE id=? AND status='draft'").run(id);
}

export function approveAllDrafts(minScore = 0): number {
  const info = db
    .prepare(
      `UPDATE messages SET status='approved', approved_at=datetime('now')
       WHERE status='draft' AND lead_id IN (SELECT lead_id FROM scores WHERE score >= ?)`,
    )
    .run(minScore);
  return Number(info.changes);
}

export function sentToday(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE status='sent' AND date(sent_at)=date('now')")
    .get() as { n: number };
  return row.n;
}

export function findLeadByPhone(phone: string): { id: number; name: string | null } | undefined {
  return db.prepare('SELECT id, name FROM leads WHERE phone = ?').get(phone) as { id: number; name: string | null } | undefined;
}

export function recordReply(leadId: number | null, jid: string, body: string, isOptout: boolean): void {
  db.prepare('INSERT INTO replies (lead_id, from_jid, body, is_optout) VALUES (?,?,?,?)').run(
    leadId,
    jid,
    body.slice(0, 2000),
    isOptout ? 1 : 0,
  );
}

export function addSuppression(phone: string, reason: string): void {
  db.prepare('INSERT INTO suppression (phone, reason) VALUES (?,?) ON CONFLICT(phone) DO NOTHING').run(phone, reason);
}

export function listMessages(limit = 500): Array<{
  id: number;
  lead_id: number;
  body: string;
  status: string;
  error: string | null;
  name: string | null;
  phone: string | null;
}> {
  return db
    .prepare(
      `SELECT m.id, m.lead_id, m.body, m.status, m.error, l.name, l.phone FROM messages m
       JOIN leads l ON l.id = m.lead_id ORDER BY m.id DESC LIMIT ?`,
    )
    .all(limit) as unknown as Array<{
    id: number;
    lead_id: number;
    body: string;
    status: string;
    error: string | null;
    name: string | null;
    phone: string | null;
  }>;
}

