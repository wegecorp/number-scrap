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
`);

// Migrasi dari versi lama (Fase 1/2) + bersihkan sisa tabel WhatsApp.
function addColumnIfMissing(table: string, col: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
addColumnIfMissing('leads', 'suggested_message', 'TEXT');
addColumnIfMissing('leads', 'contacted_at', 'TEXT');
addColumnIfMissing('campaigns', 'lead_count', 'INTEGER NOT NULL DEFAULT 0');
db.exec('DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS replies;');

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

export function listLeads(
  opts: { withPhone?: boolean; unscored?: boolean; minScore?: number; uncontacted?: boolean } = {},
): LeadRecord[] {
  const where: string[] = [];
  if (opts.withPhone) where.push('l.phone IS NOT NULL');
  if (opts.unscored) where.push('s.lead_id IS NULL');
  if (opts.uncontacted) where.push('l.contacted_at IS NULL');
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
