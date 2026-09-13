import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { config, hasAI, hasMaps } from './config.ts';
import {
  db,
  listLeads,
  getScore,
  markContacted,
  addSuppression,
  deleteLead,
  addRejected,
  countRejected,
} from './db/index.ts';
import type { LeadRecord, Candidate } from './types.ts';
import { expandQuery } from './ai/expand.ts';
import { listModels, pingAI } from './ai/client.ts';
import { candidateKey } from './ai/relevance.ts';
import { filterCandidates } from './filter/index.ts';
import { loadBlocklist, isBadCandidate, appendBlocklist } from './filter/blocklist.ts';
import { fetchInstagramProfile } from './discovery/adapters/instagram.ts';
import { chatLink } from './outreach/chat-link.ts';
import { leadsToCsv } from './export/csv.ts';
import { runDiscover, runScore, runDraft } from './pipeline.ts';

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
  await runDiscover(intent, limit);
}

async function cmdDiscoverFile(path: string, limit?: number): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`[discover] gagal baca ${path}: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const intents = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!intents.length) return console.log(`[discover] tidak ada keyword di ${path}`);
  console.log(`[discover] ${intents.length} keyword dari ${path}`);
  for (let i = 0; i < intents.length; i++) {
    console.log(`\n[discover] (${i + 1}/${intents.length}) ${intents[i]}`);
    await cmdDiscover(intents[i], limit);
  }
}

async function cmdScore(): Promise<void> {
  await runScore();
}

async function cmdDraft(): Promise<void> {
  await runDraft();
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

async function cmdClean(opts: { dry: boolean; ai: boolean }): Promise<void> {
  const rows = db.prepare('SELECT * FROM leads').all() as unknown as LeadRecord[];
  if (!rows.length) return console.log('[clean] tidak ada lead');
  const bl = loadBlocklist(undefined, true);

  const blocked: LeadRecord[] = [];
  const cands: Candidate[] = [];
  const byKey = new Map<string, LeadRecord>();
  for (const r of rows) {
    if (isBadCandidate({ name: r.name, bio: r.bio, website: r.website, url: r.url, handle: r.handle }, bl)) {
      blocked.push(r);
      continue;
    }
    const c: Candidate = {
      source: r.source,
      handle: r.handle ?? undefined,
      name: r.name,
      city: r.city ?? undefined,
      bio: r.bio ?? undefined,
      website: r.website ?? undefined,
      url: r.url ?? undefined,
      phone: r.phone ?? undefined,
    };
    cands.push(c);
    byKey.set(candidateKey(c), r);
  }

  let dropLeads: LeadRecord[] = [];
  if (opts.ai) {
    const { dropped } = await filterCandidates(cands, undefined, { ai: true });
    dropLeads = dropped.map((d) => byKey.get(d.key)).filter((x): x is LeadRecord => !!x);
  }

  const all = [...blocked, ...dropLeads];
  console.log(`[clean] total lead: ${rows.length}`);
  console.log(`[clean] bloklist    : ${blocked.length}`);
  if (opts.ai) console.log(`[clean] tak relevan : ${dropLeads.length}`);

  for (const r of all.slice(0, 15)) console.log(`  #${r.id} ${r.name} [${r.source}] ${r.phone ?? '-'}`);
  if (all.length > 15) console.log(`  ... dan ${all.length - 15} lagi`);

  if (opts.dry) {
    console.log('[clean] DRY RUN — tidak ada yang dihapus. Jalankan tanpa --dry untuk hapus permanen.');
    return;
  }
  for (const r of all) deleteLead(r.id);
  addRejected(all.map((r) => ({ key: r.phone ?? `${r.source}:${r.handle ?? r.name}`, name: r.name, source: r.source, reason: 'clean' })));
  console.log(`[clean] dihapus permanen: ${all.length}`);
}

function cmdBlock(args: string[]): void {
  const value = args[0];
  if (!value) return console.log('pakai: block <kata|domain>');
  const line = appendBlocklist(value);
  console.log(`[block] ditambahkan ke blocklist.txt: ${line}`);
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

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonBin, args, { cwd: process.cwd() });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error((err || `exit ${code}`).split('\n')[0]))));
  });
}

async function cmdDoctor(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  console.log(`[doctor] node          : v${process.versions.node} ${major >= 22 ? 'OK' : 'GAGAL (butuh Node 22.5+/24)'}`);
  console.log(`[doctor] .env          : ${existsSync('.env') ? 'ada' : 'TIDAK ADA'}`);
  console.log(`[doctor] AI            : ${hasAI ? `on (${config.ai.model} @ ${config.ai.baseUrl})` : 'off (AI_API_KEY kosong)'}`);
  console.log(
    `[doctor] IG session    : ${
      config.igSessionId ? `ada (${config.igSessionId.length} char)` : existsSync('ig/session.json') ? 'pakai ig/session.json' : 'KOSONG'
    }`,
  );
  console.log(`[doctor] search        : ${config.searchProvider} [${config.searxngUrls.join(', ') || '-'}]`);
  console.log(`[doctor] maps / osm    : ${hasMaps ? 'on' : 'off'} / ${config.osmEnabled ? 'on' : 'off'}`);
  console.log(`[doctor] bind          : ${config.host}:${config.port}`);
  console.log(`[doctor] dashboard auth: ${config.dashUser && config.dashPass ? 'on' : 'OFF (wajib saat online)'}`);
  if (config.dashPass && config.dashPass.length < 12) {
    console.log('[doctor]   ! DASH_PASS < 12 karakter — terlalu lemah kalau dashboard dibuka ke internet');
  }
  console.log(`[doctor] DB            : ${existsSync(config.dbPath) ? config.dbPath : `${config.dbPath} (akan dibuat)`}`);

  const pyExists = existsSync(config.pythonBin);
  console.log(`[doctor] PYTHON_BIN    : ${config.pythonBin} ${pyExists ? 'ada' : 'TIDAK ADA'}`);
  if (pyExists) {
    try {
      const out = await runPython(['-c', 'import instagrapi; print("ok")']);
      console.log(`[doctor] instagrapi    : ${out.trim()}`);
    } catch (err) {
      console.log(`[doctor] instagrapi    : GAGAL -> ${(err as Error).message}`);
    }
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
  console.log(`campaigns=${campaigns.n} dnc=${dnc.n} rejected=${countRejected()}`);
  console.log(`AI=${hasAI ? 'on' : 'off'} maps=${hasMaps ? 'on' : 'off'} minScore=${config.minScore}`);
}

function usage(): void {
  console.log(`ig-selling — scraper lead tim olahraga (kontak via wa.me, bukan bot)

  npm run cli -- models                   daftar model AI yang tersedia
  npm run cli -- ping-ai                  cek koneksi AI + mode JSON
  npm run cli -- ig-check <username>      cek session/proxy IG (429?)
  npm run cli -- expand   "<intent>"      lihat query hasil AI
  npm run cli -- discover "<intent>" [--limit N]   cari + enrich + simpan lead
  npm run cli -- discover --file keywords.txt [--limit N]   banyak keyword sekaligus
  npm run cli -- score                    skor lead pakai AI
  npm run cli -- draft                    susun pesan siap kirim
  npm run cli -- contacts                 lead siap dihubungi + link wa.me
  npm run cli -- mark <id...>             tandai sudah dihubungi
  npm run cli -- suppress <nomor> [note]  masukkan ke DNC list
  npm run cli -- clean [--dry] [--ai]     hapus lead sampah (bloklist; --ai = relevansi AI)
  npm run cli -- block <kata|domain>      tambah ke blocklist.txt
  npm run cli -- export [file] [--new]    export CSV (--new = belum dihubungi)
  npm run cli -- stats                    ringkasan database
  npm run cli -- doctor                   cek lingkungan (node, AI, IG, python, auth)
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
      const validLimit = limit && Number.isFinite(limit) ? limit : undefined;
      if (typeof flags.file === 'string') await cmdDiscoverFile(flags.file, validLimit);
      else await cmdDiscover(positional.join(' '), validLimit);
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
    case 'clean':
      await cmdClean({ dry: flags.dry === true, ai: flags.ai === true });
      break;
    case 'block':
      cmdBlock(positional);
      break;
    case 'export':
      cmdExport(positional[0] ?? 'leads.csv', flags.new === true);
      break;
    case 'stats':
      cmdStats();
      break;
    case 'doctor':
      await cmdDoctor();
      break;
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
