import { db } from '../db/index.ts';

const COLS = ['id', 'source', 'name', 'handle', 'city', 'phone', 'email', 'website', 'score', 'segment', 'reason', 'url'];

export function leadsToCsv(minScore = 0): string {
  const rows = db
    .prepare(
      `SELECT l.id,l.source,l.name,l.handle,l.city,l.phone,l.email,l.website,
              COALESCE(s.score,0) AS score, s.segment, s.reason, l.url
       FROM leads l LEFT JOIN scores s ON s.lead_id = l.id
       WHERE l.phone IS NOT NULL AND COALESCE(s.score,0) >= ?
       ORDER BY score DESC, l.id DESC`,
    )
    .all(minScore) as unknown as Array<Record<string, unknown>>;

  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [COLS.join(',')];
  for (const r of rows) lines.push(COLS.map((c) => escape(r[c])).join(','));
  return lines.join('\n');
}
