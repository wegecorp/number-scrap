import { db } from '../db/index.ts';
import { chatLink } from '../outreach/chat-link.ts';

const COLS = [
  'id',
  'source',
  'name',
  'handle',
  'city',
  'phone',
  'email',
  'website',
  'ig_url',
  'score',
  'segment',
  'reason',
  'suggested_message',
  'chat_link',
  'contacted_at',
];

type Row = {
  id: number;
  source: string;
  name: string | null;
  handle: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  score: number;
  segment: string | null;
  reason: string | null;
  suggested_message: string | null;
  contacted_at: string | null;
};

export function leadsToCsv(minScore = 0, opts: { uncontactedOnly?: boolean } = {}): string {
  const sql = `SELECT l.id,l.source,l.name,l.handle,l.city,l.phone,l.email,l.website,
              COALESCE(s.score,0) AS score, s.segment, s.reason, l.suggested_message, l.contacted_at
       FROM leads l LEFT JOIN scores s ON s.lead_id = l.id
       WHERE l.phone IS NOT NULL AND COALESCE(s.score,0) >= ?
         ${opts.uncontactedOnly ? 'AND l.contacted_at IS NULL' : ''}
       ORDER BY score DESC, l.id DESC`;
  const rows = db.prepare(sql).all(minScore) as unknown as Row[];

  const escape = (v: unknown): string => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [COLS.join(',')];
  for (const r of rows) {
    const igUrl = r.source === 'instagram' && r.handle ? `https://instagram.com/${r.handle}` : r.website ?? '';
    const out: Record<string, string> = {
      id: String(r.id),
      source: r.source,
      name: r.name ?? '',
      handle: r.handle ?? '',
      city: r.city ?? '',
      phone: r.phone ?? '',
      email: r.email ?? '',
      website: r.website ?? '',
      ig_url: igUrl,
      score: String(r.score),
      segment: r.segment ?? '',
      reason: r.reason ?? '',
      suggested_message: r.suggested_message ?? '',
      chat_link: r.phone ? chatLink(r.phone, r.suggested_message) : '',
      contacted_at: r.contacted_at ?? '',
    };
    lines.push(COLS.map((c) => escape(out[c])).join(','));
  }
  return lines.join('\n');
}
