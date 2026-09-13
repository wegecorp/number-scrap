import { writeFileSync } from 'node:fs';
import { config, hasAI, hasMaps } from './config.ts';
import { db, upsertLead, listLeads, saveScore, hasMessage, isSuppressed, getScore, approveMessage, approveAllDrafts, sentToday } from './db/index.ts';
import { expandQuery } from './ai/expand.ts';
import { scoreLeads } from './ai/score.ts';
import { discover } from './discovery/index.ts';
import { enrichContact } from './enrich/index.ts';
import { draftMessage } from './outreach/draft.ts';
import { createMessage } from './db/index.ts';
import { leadsToCsv } from './export/csv.ts';

async function cmdExpand(intent: string): Promise<void> {
  const q = await expandQuery(intent);
  console.log(JSON.stringify(q, null, 2));
  if (q.tooBroad) console.log('\n! Intent terlalu luas. Tambahkan tipe target (SSB/klub/tim) dan kota.');
}

async function cmdDiscover(intent: string): Promise<void> {
  const q = await expandQuery(intent);
  if (q.tooBroad) {
    console.log('! Intent terlalu luas. Tambahkan tipe target + kota, contoh: "SSB Bandung".');
    return;
  }
  const campaign = db
    .prepare('INSERT INTO campaigns (name, keyword, query_json) VALUES (?,?,?)')
    .run(intent.slice(0, 60), intent, JSON.stringify(q));
  const campaignId = Number(campaign.lastInsertRowid);

  const candidates = await discover(q);
  console.log(`[discover] kandidat: ${candidates.length}`);

  let saved = 0;
  for (const c of candidates) {
    const contact = await enrichContact(c);
    const id = upsertLead({
      ...c,
      phone: c.phone ?? contact.phones[0],
      email: c.email ?? contact.emails[0],
    });
    if (contact.phones.length > 1 || contact.emails.length > 1) {
      db.prepare('UPDATE leads SET meta = json_set(COALESCE(meta,\'{}\'), \'$.extraContacts\', ?) WHERE id = ?').run(
        JSON.stringify({ phones: contact.phones, emails: contact.emails }),
        id,
      );
    }
    saved++;
  }
  console.log(`[discover] tersimpan: ${saved} (campaign #${campaignId})`);
  console.log(`[discover] lead punya nomor: ${listLeads({ withPhone: true }).length}`);
}

async function cmdScore(): Promise<void> {
  const leads = listLeads({ withPhone: true, unscored: true });
  if (!leads.length) return console.log('tidak ada lead baru untuk diskor');
  console.log(`[score] menilai ${leads.length} lead...`);
  const { scores, model } = await scoreLeads(leads);
  for (const s of scores) saveScore(s, model);
  console.log(`[score] selesai (model: ${model})`);
}

async function cmdDraft(): Promise<void> {
  const leads = listLeads({ withPhone: true, minScore: config.minScore });
  let made = 0;
  for (const lead of leads) {
    if (isSuppressed(lead.phone)) continue;
    if (hasMessage(lead.id)) continue;
    const s = getScore(lead.id);
    const body = await draftMessage(lead, s?.template_id);
    createMessage(lead.id, body);
    made++;
  }
  console.log(`[draft] pesan draft dibuat: ${made}`);
}

function cmdExport(path = 'leads.csv'): void {
  writeFileSync(path, leadsToCsv(config.minScore), 'utf8');
  console.log(`[export] ${path}`);
}

function cmdStats(): void {
  const total = db.prepare('SELECT COUNT(*) AS n FROM leads').get() as { n: number };
  const withPhone = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE phone IS NOT NULL').get() as { n: number };
  const scored = db.prepare('SELECT COUNT(*) AS n FROM scores').get() as { n: number };
  const drafts = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status='draft'").get() as { n: number };
  const approved = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status='approved'").get() as { n: number };
  const replies = db.prepare('SELECT COUNT(*) AS n FROM replies').get() as { n: number };
  console.log(`leads=${total.n} withPhone=${withPhone.n} scored=${scored.n} drafts=${drafts.n} approved=${approved.n}`);
  console.log(`terkirim hari ini=${sentToday()}/${config.dailySendCap} balasan=${replies.n}`);
  console.log(`AI=${hasAI ? 'on' : 'off'} maps=${hasMaps ? 'on' : 'off'} minScore=${config.minScore}`);
}

function cmdApprove(arg?: string): void {
  if (arg === 'all') {
    const n = approveAllDrafts(config.minScore);
    console.log(`[approve] ${n} draft disetujui`);
    return;
  }
  if (arg) {
    approveMessage(Number(arg));
    console.log(`[approve] pesan #${arg} disetujui`);
    return;
  }
  console.log('pakai: approve <id> | approve all');
}

function usage(): void {
  console.log(`ig-selling (Fase 1: harvester, tanpa WA)

  npm run cli -- expand   "<intent>"     lihat query hasil AI
  npm run cli -- discover "<intent>"     cari + enrich + simpan lead
  npm run cli -- score                   skor lead pakai AI
  npm run cli -- draft                   buat draft pesan untuk lead bagus
  npm run cli -- approve <id>|all        setujui draft untuk dikirim
  npm run cli -- export [file.csv]       export lead (default leads.csv)
  npm run cli -- stats                   ringkasan database
  npm run cli -- wa                      (atau npm run wa) konek WhatsApp, scan QR, kirim
`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'expand':
      await cmdExpand(rest.join(' '));
      break;
    case 'discover':
      await cmdDiscover(rest.join(' '));
      break;
    case 'score':
      await cmdScore();
      break;
    case 'draft':
      await cmdDraft();
      break;
    case 'approve':
      cmdApprove(rest[0]);
      break;
    case 'export':
      cmdExport(rest[0]);
      break;
    case 'stats':
      cmdStats();
      break;
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
