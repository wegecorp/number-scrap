import { writeFileSync } from 'node:fs';
import { config, hasAI, hasMaps } from './config.ts';
import {
  db,
  upsertLead,
  listLeads,
  saveScore,
  getScore,
  setSuggestedMessage,
  markContacted,
  addSuppression,
  createCampaign,
  setCampaignLeadCount,
} from './db/index.ts';
import type { LeadRecord } from './types.ts';
import { expandQuery } from './ai/expand.ts';
import { scoreLeads } from './ai/score.ts';
import { listModels, pingAI } from './ai/client.ts';
import { discover } from './discovery/index.ts';
import { fetchInstagramProfile } from './discovery/adapters/instagram.ts';
import { enrichContact } from './enrich/index.ts';
import { draftMessage } from './outreach/draft.ts';
import { chatLink } from './outreach/chat-link.ts';
import { leadsToCsv } from './export/csv.ts';

function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function cmdExpand(intent: string): Promise<void> {
  const q = await expandQuery(intent);
  console.log(JSON.stringify(q, null, 2));
  if (q.tooBroad) console.log('\n! Intent terlalu luas. Tambahkan tipe target (SSB/klub/tim) dan kota.');
}

async function cmdDiscover(intent: string, limit?: number): Promise<void> {
  const q = await expandQuery(intent);
  if (q.tooBroad) {
    console.log('! Intent terlalu luas. Tambahkan tipe target + kota, contoh: "SSB Bandung".');
    return;
  }
  const campaignId = createCampaign(intent.slice(0, 60), intent, q);

  const candidates = await discover(q, { limit });
  console.log(`[discover] kandidat: ${candidates.length}`);

  const seen = new Set<number>();
  for (const c of candidates) {
    const contact = await enrichContact(c);
    const id = upsertLead({
      ...c,
      phone: c.phone ?? contact.phones[0],
      email: c.email ?? contact.emails[0],
    });
    if (contact.phones.length > 1 || contact.emails.length > 1) {
      db.prepare("UPDATE leads SET meta = json_set(COALESCE(meta,'{}'), '$.extraContacts', ?) WHERE id = ?").run(
        JSON.stringify({ phones: contact.phones, emails: contact.emails }),
        id,
      );
    }
    seen.add(id);
  }
  setCampaignLeadCount(campaignId, seen.size);
  console.log(`[discover] tersimpan: ${seen.size} (campaign #${campaignId})`);
  console.log(`[discover] total lead punya nomor: ${listLeads({ withPhone: true }).length}`);
}

async function cmdScore(): Promise<void> {
  const leads = listLeads({ withPhone: true, unscored: true });
  if (!leads.length) return console.log('tidak ada lead baru untuk diskor');
  console.log(`[score] menilai ${leads.length} lead...`);
  const { scores, model } = await scoreLeads(leads);
  for (const s of scores) saveScore(s, model);
  console.log(`[score] selesai (model: ${model})`);
}

function leadsNeedingDraft(): LeadRecord[] {
  return db
    .prepare(
      `SELECT l.* FROM leads l LEFT JOIN scores s ON s.lead_id = l.id
       WHERE l.phone IS NOT NULL AND l.suggested_message IS NULL AND COALESCE(s.score,0) >= ?
       ORDER BY COALESCE(s.score,0) DESC`,
    )
    .all(config.minScore) as unknown as LeadRecord[];
}

async function cmdDraft(): Promise<void> {
  const leads = leadsNeedingDraft();
  if (!leads.length) return console.log('tidak ada lead yang perlu pesan');
  let made = 0;
  for (const lead of leads) {
    const s = getScore(lead.id);
    const body = await draftMessage(lead, s?.template_id);
    setSuggestedMessage(lead.id, body);
    made++;
  }
  console.log(`[draft] pesan disusun: ${made}`);
}

function cmdContacts(): void {
  const leads = listLeads({ withPhone: true, minScore: config.minScore, uncontacted: true });
  if (!leads.length) return console.log('belum ada lead siap hubungi. jalankan: discover -> score -> draft');
  for (const l of leads) {
    const s = getScore(l.id);
    console.log(`\n#${l.id}  [${s?.score ?? '-'}]  ${l.name}  ${l.phone}`);
    if (l.suggested_message) console.log(`  pesan: ${l.suggested_message.slice(0, 100)}${l.suggested_message.length > 100 ? '...' : ''}`);
    console.log(`  chat : ${chatLink(l.phone as string, l.suggested_message)}`);
  }
  console.log(`\n${leads.length} lead belum dihubungi. Tandai setelah kirim: npm run cli -- mark <id>`);
}

function cmdMark(ids: string[]): void {
  let n = 0;
  for (const id of ids) {
    markContacted(Number(id));
    n++;
  }
  console.log(`[mark] ${n} lead ditandai sudah dihubungi`);
}

function cmdSuppress(args: string[]): void {
  const phone = args[0];
  if (!phone) return console.log('pakai: suppress <nomor> [alasan]');
  addSuppression(phone, args.slice(1).join(' ') || 'manual');
  console.log(`[suppress] ${phone} masuk DNC list`);
}

function cmdExport(path = 'leads.csv', onlyNew = false): void {
  writeFileSync(path, leadsToCsv(config.minScore, { uncontactedOnly: onlyNew }), 'utf8');
  console.log(`[export] ${path}${onlyNew ? ' (hanya belum dihubungi)' : ''}`);
}

async function cmdModels(): Promise<void> {
  try {
    const models = await listModels();
    console.log(`[models] ${models.length} model dari ${config.ai.baseUrl}`);
    for (const m of models) console.log(`  ${m}`);
    console.log('\nSet AI_MODEL ke salah satu id di atas.');
  } catch (err) {
    console.error(`[models] gagal: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function cmdPingAI(): Promise<void> {
  console.log(`[ping-ai] base=${config.ai.baseUrl} model=${config.ai.model} jsonMode=${config.ai.jsonMode}`);
  try {
    const r = await pingAI();
    console.log(`[ping-ai] OK · mode=${r.mode} · reply=${r.text.trim().slice(0, 120)}`);
  } catch (err) {
    console.error(`[ping-ai] gagal: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function cmdIgCheck(handle: string): Promise<void> {
  if (!handle) return console.log('pakai: ig-check <username>');
  const proxy = (process.env.IG_PROXY_URL ?? '').trim();
  console.log(`[ig-check] handle=${handle} session=${config.igSessionId ? 'ada' : 'kosong'} proxy=${proxy ? 'on' : 'off'} delay=${config.igFetchDelayMs}ms`);
  try {
    const c = await fetchInstagramProfile(handle);
    const meta = (c.meta ?? {}) as { followers?: number };
    console.log(`[ig-check] OK · ${c.name} · followers=${meta.followers ?? '-'} · phone=${c.phone ?? '-'} · web=${c.website ?? '-'}`);
    console.log('bio:', (c.bio ?? '').slice(0, 140));
  } catch (err) {
    console.error(`[ig-check] gagal: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

function cmdStats(): void {
  const total = db.prepare('SELECT COUNT(*) AS n FROM leads').get() as { n: number };
  const withPhone = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE phone IS NOT NULL').get() as { n: number };
  const scored = db.prepare('SELECT COUNT(*) AS n FROM scores').get() as { n: number };
  const contacted = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE contacted_at IS NOT NULL').get() as { n: number };
  const dnc = db.prepare('SELECT COUNT(*) AS n FROM suppression').get() as { n: number };
  const campaigns = db.prepare('SELECT COUNT(*) AS n FROM campaigns').get() as { n: number };
  console.log(`leads=${total.n} withPhone=${withPhone.n} scored=${scored.n} contacted=${contacted.n}`);
  console.log(`campaigns=${campaigns.n} dnc=${dnc.n}`);
  console.log(`AI=${hasAI ? 'on' : 'off'} maps=${hasMaps ? 'on' : 'off'} minScore=${config.minScore}`);
}

function usage(): void {
  console.log(`ig-selling — scraper lead tim olahraga (kontak via wa.me, bukan bot)

  npm run cli -- models                   daftar model AI yang tersedia
  npm run cli -- ping-ai                  cek koneksi AI + mode JSON
  npm run cli -- ig-check <username>      cek session/proxy IG (429?)
  npm run cli -- expand   "<intent>"      lihat query hasil AI
  npm run cli -- discover "<intent>" [--limit N]   cari + enrich + simpan lead
  npm run cli -- score                    skor lead pakai AI
  npm run cli -- draft                    susun pesan siap kirim
  npm run cli -- contacts                 lead siap dihubungi + link wa.me
  npm run cli -- mark <id...>             tandai sudah dihubungi
  npm run cli -- suppress <nomor> [note]  masukkan ke DNC list
  npm run cli -- export [file] [--new]    export CSV (--new = belum dihubungi)
  npm run cli -- stats                    ringkasan database
`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  switch (cmd) {
    case 'models':
      await cmdModels();
      break;
    case 'ping-ai':
      await cmdPingAI();
      break;
    case 'ig-check':
      await cmdIgCheck(positional[0] ?? '');
      break;
    case 'expand':
      await cmdExpand(positional.join(' '));
      break;
    case 'discover': {
      const limit = typeof flags.limit === 'string' ? Number(flags.limit) : undefined;
      await cmdDiscover(positional.join(' '), limit && Number.isFinite(limit) ? limit : undefined);
      break;
    }
    case 'score':
      await cmdScore();
      break;
    case 'draft':
      await cmdDraft();
      break;
    case 'contacts':
      cmdContacts();
      break;
    case 'mark':
      cmdMark(positional);
      break;
    case 'suppress':
      cmdSuppress(positional);
      break;
    case 'export':
      cmdExport(positional[0] ?? 'leads.csv', flags.new === true);
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
