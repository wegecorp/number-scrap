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
  suggested_message TEXT,
  contacted_at TEXT,
  campaign_id INTEGER,
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
  lead_count INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS suppression (
  phone TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rejected (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  name TEXT,
  source TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rejected_key ON rejected(key);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  cmd TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  log_path TEXT,
  exit_code INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
`);

// Migrasi dari versi lama (Fase 1/2) + bersihkan sisa tabel WhatsApp.
function addColumnIfMissing(table: string, col: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
addColumnIfMissing('leads', 'suggested_message', 'TEXT');
addColumnIfMissing('leads', 'contacted_at', 'TEXT');
addColumnIfMissing('leads', 'campaign_id', 'INTEGER');
addColumnIfMissing('campaigns', 'lead_count', 'INTEGER NOT NULL DEFAULT 0');
db.exec('DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS replies;');

export function upsertLead(c: Candidate, campaignId: number | null = null): number {
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
       email=COALESCE(?,email), url=COALESCE(?,url), meta=COALESCE(?,meta),
       campaign_id=COALESCE(campaign_id, ?), updated_at=datetime('now')
       WHERE id=?`,
    ).run(c.name, c.city ?? null, c.bio ?? null, c.website ?? null, c.phone ?? null, c.rawPhone ?? null, c.email ?? null, c.url ?? null, meta, campaignId, existing.id);
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO leads (source,handle,name,city,bio,website,phone,raw_phone,email,url,meta,campaign_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(c.source, c.handle ?? null, c.name, c.city ?? null, c.bio ?? null, c.website ?? null, c.phone ?? null, c.rawPhone ?? null, c.email ?? null, c.url ?? null, meta, campaignId);
  return Number(info.lastInsertRowid);
}

export function listLeads(
  opts: {
    withPhone?: boolean;
    unscored?: boolean;
    minScore?: number;
    uncontacted?: boolean;
    source?: string;
    campaignId?: number;
    q?: string;
    limit?: number;
  } = {},
): LeadRecord[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.withPhone) where.push('l.phone IS NOT NULL');
  if (opts.unscored) where.push('s.lead_id IS NULL');
  if (opts.uncontacted) where.push('l.contacted_at IS NULL');
  if (opts.minScore != null) {
    where.push('COALESCE(s.score,0) >= ?');
    params.push(opts.minScore);
  }
  if (opts.source) {
    where.push('l.source = ?');
    params.push(opts.source);
  }
  if (opts.campaignId != null) {
    where.push('l.campaign_id = ?');
    params.push(opts.campaignId);
  }
  if (opts.q) {
    where.push('(l.name LIKE ? OR l.handle LIKE ? OR l.phone LIKE ? OR l.city LIKE ?)');
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  const limit = opts.limit ?? 500;
  const sql = `SELECT l.*, s.score, s.reason, s.segment FROM leads l LEFT JOIN scores s ON s.lead_id = l.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(s.score,0) DESC, l.id DESC LIMIT ${Number(limit)}`;
  return db.prepare(sql).all(...params) as unknown as LeadRecord[];
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

export function setSuggestedMessage(leadId: number, message: string): void {
  db.prepare('UPDATE leads SET suggested_message=?, updated_at=datetime(\'now\') WHERE id=?').run(message, leadId);
}

export function markContacted(leadId: number): void {
  db.prepare("UPDATE leads SET contacted_at=datetime('now') WHERE id=? AND contacted_at IS NULL").run(leadId);
}

export function isSuppressed(phone: string | null): boolean {
  if (!phone) return false;
  return !!db.prepare('SELECT 1 FROM suppression WHERE phone = ?').get(phone);
}

export function addSuppression(phone: string, reason: string): void {
  db.prepare('INSERT INTO suppression (phone, reason) VALUES (?,?) ON CONFLICT(phone) DO NOTHING').run(phone, reason);
}

export function createCampaign(name: string, keyword: string, query: unknown): number {
  const info = db
    .prepare('INSERT INTO campaigns (name, keyword, query_json) VALUES (?,?,?)')
    .run(name, keyword, JSON.stringify(query));
  return Number(info.lastInsertRowid);
}

export function setCampaignLeadCount(id: number, count: number): void {
  db.prepare('UPDATE campaigns SET lead_count=? WHERE id=?').run(count, id);
}

export function deleteLead(id: number): void {
  db.prepare('DELETE FROM scores WHERE lead_id=?').run(id);
  db.prepare('DELETE FROM leads WHERE id=?').run(id);
}

export function addRejected(entries: Array<{ key: string; name: string; source?: string; reason: string }>): void {
  const stmt = db.prepare('INSERT INTO rejected (key, name, source, reason) VALUES (?,?,?,?)');
  for (const e of entries) stmt.run(e.key, e.name ?? null, e.source ?? null, e.reason);
}

export function countRejected(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM rejected').get() as { n: number }).n;
}

export type Job = {
  id: number;
  cmd: string;
  status: string;
  log_path: string | null;
  exit_code: number | null;
  created_at: string;
  finished_at: string | null;
};

export function createJob(cmd: string, logPath: string): number {
  const info = db.prepare('INSERT INTO jobs (cmd, log_path) VALUES (?,?)').run(cmd, logPath);
  return Number(info.lastInsertRowid);
}

export function finishJob(id: number, exitCode: number | null, status = 'done'): void {
  db.prepare("UPDATE jobs SET status=?, exit_code=?, finished_at=datetime('now') WHERE id=?").run(status, exitCode, id);
}

export function getJob(id: number): Job | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as unknown as Job | undefined;
}

export function runningJob(): Job | undefined {
  return db.prepare("SELECT * FROM jobs WHERE status='running' ORDER BY id DESC LIMIT 1").get() as unknown as Job | undefined;
}

export function latestJob(): Job | undefined {
  return db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 1').get() as unknown as Job | undefined;
}

export function listCampaigns(
  opts: { limit?: number; offset?: number } = {},
): Array<{ id: number; name: string; keyword: string; lead_count: number; created_at: string }> {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  return db
    .prepare('SELECT id, name, keyword, lead_count, created_at FROM campaigns ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as unknown as Array<{ id: number; name: string; keyword: string; lead_count: number; created_at: string }>;
}

export function countCampaigns(): number {
  return (db.prepare('SELECT COUNT(*) n FROM campaigns').get() as { n: number }).n;
}

export function matchedLeadsForBlocklist(
  isBad: (lead: { name: string | null; bio: string | null; website: string | null; url: string | null }) => boolean,
): LeadRecord[] {
  const rows = db.prepare('SELECT * FROM leads').all() as unknown as LeadRecord[];
  return rows.filter((r) => isBad({ name: r.name, bio: r.bio, website: r.website, url: r.url }));
}
