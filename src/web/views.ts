import type { LeadRecord } from '../types.ts';
import { chatLink } from '../outreach/chat-link.ts';

export type Filters = { q: string; source: string; minScore: number; onlyNew: boolean; campaign: string };
type Row = LeadRecord & { score: number | null; reason: string | null; segment: string | null; campaign?: string | null };

export type PageOpts = {
  campaigns: Array<{ id: number; keyword: string; lead_count: number }>;
  sources: string[];
  filters: Filters;
  running?: { id: number; cmd: string } | null;
  jobLog?: string;
  flash?: string;
  total?: number;
  page?: number;
  perPage?: number;
};

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

function qs(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.source) p.set('source', f.source);
  if (f.minScore) p.set('min_score', String(f.minScore));
  if (f.onlyNew) p.set('new', '1');
  if (f.campaign) p.set('campaign', f.campaign);
  return p.toString();
}

function pageHref(f: Filters, page: number, perPage: number): string {
  const p = new URLSearchParams(qs(f));
  if (page > 1) p.set('page', String(page));
  if (perPage !== 25) p.set('per_page', String(perPage));
  return `?${p.toString()}`;
}

export function pager(f: Filters, page: number, perPage: number, total: number): string {
  if (total <= 0) return '';
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page), pages);
  const from = (p - 1) * perPage + 1;
  const to = Math.min(total, p * perPage);
  const prev = p > 1 ? `<a class="pg" href="${esc(pageHref(f, p - 1, perPage))}">« Sebelumnya</a>` : `<span class="pg off">« Sebelumnya</span>`;
  const next = p < pages ? `<a class="pg" href="${esc(pageHref(f, p + 1, perPage))}">Berikutnya »</a>` : `<span class="pg off">Berikutnya »</span>`;
  const sizes = [25, 50, 100]
    .map((n) => (n === perPage ? `<b>${n}</b>` : `<a href="${esc(pageHref(f, 1, n))}">${n}</a>`))
    .join(' · ');
  return `<div class="pager">
 <span class="muted">${from}–${to} dari ${total}</span>
 <span class="pgrow">${prev}<span class="pg">Hal ${p} / ${pages}</span>${next}</span>
 <span class="muted">per hal: ${sizes}</span>
</div>`;
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
 :root{
  --canvas:#fffaf0;--soft:#faf5e8;--card:#f5f0e0;--strong:#ebe6d6;
  --line:#e5e5e5;--line-soft:#f0f0f0;
  --ink:#0a0a0a;--body:#3a3a3a;--muted:#6a6a6a;--muted-soft:#9a9a9a;
  --pink:#ff4d8b;--pink-soft:#ffe3ee;--teal:#1a3a3a;
  --ok:#22c55e;--warn:#f59e0b;--err:#ef4444;
  --r-sm:8px;--r-md:12px;--r-lg:16px;
 }
 *{box-sizing:border-box}
 body{font:15px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:var(--canvas);color:var(--body)}
 header{padding:0 20px;min-height:64px;background:var(--canvas);display:flex;gap:2px;align-items:center;border-bottom:1px solid var(--line);flex-wrap:wrap;position:sticky;top:0;z-index:10}
 .brand{font-weight:700;letter-spacing:-.5px;color:var(--ink);margin-right:12px;font-size:16px}
 .brand::before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--pink);margin-right:8px}
 header a{color:var(--body);text-decoration:none;font-size:14px;font-weight:500;padding:8px 12px;border-radius:9999px}
 header a:hover{background:var(--pink-soft);color:var(--ink)}
 main{padding:24px;max-width:1200px;margin:0 auto}
 h3{font-size:22px;font-weight:600;letter-spacing:-.4px;color:var(--ink);margin:20px 0 12px}
 h4{font-size:16px;font-weight:600;color:var(--ink);margin:18px 0 8px}
 a{color:var(--pink)}
 table{border-collapse:separate;border-spacing:0;width:100%;background:var(--canvas);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
 th,td{border-bottom:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:top}
 th{position:sticky;top:64px;background:var(--card);color:var(--ink);font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
 tbody tr:last-child td{border-bottom:0}
 tr:hover{background:var(--soft)}
 .score{font-weight:700}.ok{color:var(--ok)}.mid{color:var(--warn)}.low{color:var(--muted-soft)}
 button{background:var(--pink);border:0;color:#fff;padding:10px 16px;border-radius:var(--r-md);cursor:pointer;margin:1px;font:inherit;font-weight:600;font-size:14px}
 button:hover{filter:brightness(.95)}
 button.ghost{background:var(--canvas);color:var(--ink);border:1px solid var(--line)}
 button.ghost:hover{background:var(--soft);filter:none}
 button.danger{background:var(--err)}
 a.chat{display:inline-block;background:var(--teal);color:#fff;padding:10px 16px;border-radius:var(--r-md);text-decoration:none;font-weight:600;font-size:14px}
 a.chat:hover{filter:brightness(1.2)}
 code{background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
 .muted{color:var(--muted)}.msg{max-width:320px;white-space:pre-wrap}
 form{display:inline;margin:0}
 .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
 .panel{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);margin-bottom:14px;overflow:hidden}
 .panel>summary{cursor:pointer;padding:14px 18px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:10px;list-style:none;user-select:none}
 .panel>summary::-webkit-details-marker{display:none}
 .panel>summary::after{content:"▾";margin-left:auto;color:var(--muted);font-size:12px;transition:transform .15s}
 .panel[open]>summary::after{transform:rotate(180deg)}
 .panel[open]>summary{border-bottom:1px solid var(--line)}
 .panel>p,.panel>form,.panel>.bar{padding:14px 18px}
 .panel>form{display:block}
 .badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:9999px;background:var(--pink);color:#fff;font-size:12px;font-weight:600}
 input,select,textarea{background:var(--canvas);color:var(--ink);border:1px solid var(--line);border-radius:var(--r-md);padding:10px 12px;font:inherit}
 input:focus,select:focus,textarea:focus{outline:none;border-color:var(--ink)}
 pre{background:var(--soft);border:1px solid var(--line);padding:14px;border-radius:var(--r-lg);max-height:320px;overflow:auto;white-space:pre-wrap;color:var(--body)}
 .spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--pink);border-radius:50%;animation:s 1s linear infinite;vertical-align:-2px}
 @keyframes s{to{transform:rotate(360deg)}}
 .flash{background:var(--pink-soft);border:1px solid var(--pink);color:var(--ink);padding:10px 14px;border-radius:var(--r-lg);margin-bottom:14px}
 .pager{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin:14px 0}
 .pgrow{display:flex;gap:6px;align-items:center}
 .pg{display:inline-block;background:var(--card);border:1px solid var(--line);color:var(--ink);padding:8px 12px;border-radius:var(--r-md);text-decoration:none}
 .pg:hover{background:var(--pink-soft)}
 .pg.off{opacity:.4}
 .pager a b,.pager b{color:var(--pink)}
 @media(max-width:640px){
  main{padding:16px}
  header{min-height:auto;padding:10px 14px;gap:4px}
  thead{display:none}
  table{border:0;background:transparent}
  table,tr,td{display:block;width:100%}
  tr{border:1px solid var(--line);border-radius:var(--r-lg);margin-bottom:10px;padding:6px 2px;background:var(--canvas)}
  tr:hover{background:var(--canvas)}
  td{border:0;padding:6px 12px}
  td::before{content:attr(data-label);color:var(--muted);display:inline-block;min-width:92px;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .bar{flex-direction:column;align-items:stretch}
  .bar input,.bar select,.bar textarea,.bar button,.bar a.chat{width:100%;min-height:44px}
  .bar label{display:flex;align-items:center;gap:8px;min-height:32px}
  .msg{max-width:100%}
  .pager{flex-direction:column;align-items:stretch}
  .pgrow{justify-content:space-between}
  .pg{flex:1;text-align:center;min-height:40px}
  a.chat{display:block;text-align:center;min-height:44px}
 }
</style></head><body>
<header>
 <span class="brand">number-scrap</span>
 <a href="/">Leads</a>
 <a href="/pipeline">Pipeline</a>
 <a href="/campaigns">Campaign</a>
 <a href="/blocklist">Blocklist</a>
 <a href="/rejected">Rejected</a>
 <a href="/stats">Stats</a>
 <a href="/export.csv">Export</a>
</header>
<main>${body}</main>
</body></html>`;
}

function previewMsg(s: string | null, words = 6): string {
  const parts = (s ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= words) return parts.join(' ');
  return parts.slice(0, words).join(' ') + ' …';
}

function scoreClass(s: number | null): string {
  if (s == null) return 'low';
  if (s >= 70) return 'ok';
  if (s >= 40) return 'mid';
  return 'low';
}

export function leadsPage(rows: Row[], opts: PageOpts): string {
  const f = opts.filters;
  const campaignOptions = opts.campaigns
    .map((c) => `<option value="${c.id}" ${f.campaign === String(c.id) ? 'selected' : ''}>${esc(c.keyword)} (${c.lead_count})</option>`)
    .join('');
  const sourceOptions = opts.sources.map((s) => `<option value="${esc(s)}" ${f.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
  const exportHref = `/export.csv${qs(f) ? '?' + qs(f) : ''}`;
  const activeCount = [f.q, f.source, f.campaign, f.minScore ? 'x' : '', f.onlyNew ? 'x' : ''].filter(Boolean).length;

  const body = `
${opts.flash ? `<div class="flash">${esc(opts.flash)}</div>` : ''}
${opts.running ? `<p><span class="spin"></span> Job #${opts.running.id} berjalan — <a href="/pipeline">lihat progres</a></p>` : ''}
<details class="panel">
 <summary>Filter &amp; Pencarian${activeCount ? ` <span class="badge">${activeCount}</span>` : ''}</summary>
 <form method="get" action="/" class="bar">
  <input type="search" name="q" placeholder="cari nama/nomor/kota" value="${esc(f.q)}"/>
  <select name="source"><option value="">semua sumber</option>${sourceOptions}</select>
  <select name="campaign"><option value="">semua campaign</option>${campaignOptions}</select>
  <input type="number" name="min_score" min="0" max="100" placeholder="min skor" value="${f.minScore || ''}" style="width:100px"/>
  <label><input type="checkbox" name="new" value="1" ${f.onlyNew ? 'checked' : ''}/> belum dihubungi</label>
  <button type="submit">Terapkan</button>
  <a href="/" class="muted">reset</a>
  <a href="${esc(exportHref)}" class="muted">export CSV</a>
 </form>
</details>
<details class="panel">
 <summary>Aksi lain</summary>
 <form method="post" action="/clean" class="bar">
  <span class="muted">Bersihkan hasil${f.campaign ? ` (campaign terpilih)` : ' (semua)'}:</span>
  <input type="hidden" name="campaign" value="${esc(f.campaign)}"/>
  <label><input type="checkbox" name="ai" value="1" checked/> pakai AI</label>
  <button type="submit" class="ghost">Preview &amp; bersihkan</button>
 </form>
 <form method="post" action="/draft" class="bar">
  <span class="muted">Susun pesan untuk lead berskor tanpa pesan:</span>
  <button type="submit">Susun pesan</button>
 </form>
</details>
<form method="post" action="/bulk">
<p>
 <button type="submit" name="action" value="contacted">Tandai terpilih</button>
 <button type="submit" name="action" value="delete" class="danger" onclick="return confirm('Hapus permanen yang terpilih?')">Hapus terpilih</button>
 <button type="submit" name="action" value="block" class="ghost" onclick="return confirm('Blokir & hapus yang terpilih?')">Blokir terpilih</button>
</p>
${pager(f, opts.page ?? 1, opts.perPage ?? 25, opts.total ?? rows.length)}
<table>
<thead><tr><th></th><th>Skor</th><th>Nama</th><th>Nomor</th><th>Sumber</th><th>Kota</th><th>Campaign</th><th>Pesan</th><th>Aksi</th></tr></thead>
<tbody>
${rows
  .map(
    (r) => `<tr>
 <td data-label=""><input type="checkbox" name="ids" value="${r.id}"/></td>
 <td data-label="Skor" class="score ${scoreClass(r.score)}">${r.score ?? '-'}</td>
 <td data-label="Nama">${esc(r.name)}${r.handle ? ` <span class="muted">@${esc(r.handle)}</span>` : ''}</td>
 <td data-label="Nomor">${r.phone ? esc(r.phone) : '<span class="muted">-</span>'}</td>
 <td data-label="Sumber">${esc(r.source)}</td>
 <td data-label="Kota">${esc(r.city)}</td>
 <td data-label="Campaign" class="muted">${esc(r.campaign ?? '')}</td>
 <td data-label="Pesan" class="msg muted">${esc(previewMsg(r.suggested_message))}</td>
 <td data-label="Aksi">
  ${r.phone && !r.contacted_at ? `<a class="chat" target="_blank" href="${esc(chatLink(r.phone, r.suggested_message))}">Chat</a>` : ''}
  ${r.contacted_at ? `<span class="ok">sudah</span>` : `<button class="ghost" type="submit" formaction="/contacted" name="id" value="${r.id}">Tandai</button>`}
  <button class="ghost" type="submit" formaction="/block" name="id" value="${r.id}" onclick="return confirm('Blokir & hapus?')">Blokir</button>
  <button class="danger" type="submit" formaction="/delete" name="id" value="${r.id}" onclick="return confirm('Hapus permanen?')">Hapus</button>
 </td>
</tr>`,
  )
  .join('')}
</tbody></table>
</form>
${pager(f, opts.page ?? 1, opts.perPage ?? 25, opts.total ?? rows.length)}`;
  return layout('Leads', body);
}

export type Suggest = { seed: string; terms: string[]; city: string; targetType: string; tooBroad: boolean };

export function pipelinePage(opts: PageOpts & { seeds: string; suggestions: Suggest[] }): string {
  const running = opts.running;
  const suggested = opts.suggestions.length ? opts.suggestions.map((s) => s.terms.join('\n')).join('\n') : '';
  const detail = opts.suggestions
    .map(
      (s) =>
        `<li><b>${esc(s.seed)}</b> — kota: ${esc(s.city || '-')}, tipe: ${esc(s.targetType || '-')}${s.tooBroad ? ' <span class="mid">(terlalu luas)</span>' : ''}</li>`,
    )
    .join('');

  const body = `
${opts.flash ? `<div class="flash">${esc(opts.flash)}</div>` : ''}
${
  running
    ? `<p><span class="spin"></span> Job #${running.id} berjalan: <code>${esc(running.cmd)}</code></p>
       <p class="muted">Halaman auto-refresh. Log di bawah.</p>`
    : `<h3>1. Kata kunci awal</h3>
<form method="post" action="/suggest" class="bar">
 <textarea name="seeds" rows="4" cols="40" placeholder="SSB Bandung&#10;klub futsal Bandung">${esc(opts.seeds)}</textarea>
 <button type="submit">Saran AI</button>
 <span class="muted">AI mengusulkan frasa pencarian; bisa kamu ubah di langkah 2.</span>
</form>
${detail ? `<ul>${detail}</ul>` : ''}
<h3>2. Frasa pencarian (bisa diedit)</h3>
<form method="post" action="/run" class="bar">
 <textarea name="terms" rows="6" cols="50" placeholder="ssb bandung&#10;sekolah sepak bola bandung&#10;futsal bandung">${esc(suggested)}</textarea>
 <input type="number" name="limit" value="20" min="1" max="200" style="width:90px"/>
 <button type="submit">Jalankan (cari + skor + pesan)</button>
</form>
<p class="muted">Satu frasa per baris. Tiap baris jadi satu campaign.</p>`
}
<h3>Log</h3>
<pre>${esc(opts.jobLog ?? '(belum ada log)')}</pre>
${running ? `<script>setTimeout(function(){ location.href='/pipeline'; }, 3000);</script>` : ''}`;
  return layout('Pipeline', body);
}

export function cleanPage(items: Array<{ id: number; name: string; source: string; reason: string }>, opts: PageOpts & { campaignId: string }): string {
  const body = `
<h3>Bersihkan hasil${opts.campaignId ? ` (campaign #${esc(opts.campaignId)})` : ' (semua)'}</h3>
${
  items.length
    ? `<p>${items.length} lead akan dihapus permanen:</p>
<table><thead><tr><th>#</th><th>Nama</th><th>Sumber</th><th>Alasan</th></tr></thead><tbody>
${items.map((i) => `<tr><td>${i.id}</td><td>${esc(i.name)}</td><td>${esc(i.source)}</td><td class="muted">${esc(i.reason)}</td></tr>`).join('')}
</tbody></table>
<form method="post" action="/clean/apply">
 ${items.map((i) => `<input type="hidden" name="id" value="${i.id}"/>`).join('')}
 ${items.map((i) => `<input type="hidden" name="name" value="${esc(i.name)}"/>`).join('')}
 ${items.map((i) => `<input type="hidden" name="reason" value="${esc(i.reason)}"/>`).join('')}
 <input type="hidden" name="campaign" value="${esc(opts.campaignId)}"/>
 <p><button class="danger" type="submit" onclick="return confirm('Hapus permanen ${items.length} lead?')">Hapus permanen ${items.length} lead</button>
 <a href="/" class="muted">batal</a></p>
</form>`
    : `<p class="ok">Tidak ada yang perlu dibuang. Bagus.</p><p><a href="/" class="muted">kembali ke leads</a></p>`
}`;
  return layout('Bersihkan', body);
}

export function campaignsPage(campaigns: Array<{ id: number; keyword: string; lead_count: number; created_at: string }>, opts: PageOpts): string {
  const body = `
<h3>Campaign</h3>
<table><thead><tr><th>#</th><th>Keyword</th><th>Lead</th><th>Dibuat</th><th></th></tr></thead><tbody>
${campaigns
  .map(
    (c) => `<tr>
 <td data-label="#">${c.id}</td>
 <td data-label="Keyword">${esc(c.keyword)}</td>
 <td data-label="Lead">${c.lead_count}</td>
 <td data-label="Dibuat" class="muted">${esc(c.created_at)}</td>
 <td data-label="Aksi">
  <a class="chat" href="/?campaign=${c.id}">Lihat lead</a>
  <a class="muted" href="/pipeline">jalankan lagi</a>
  <form method="post" action="/campaigns/delete"><input type="hidden" name="id" value="${c.id}"/><button class="danger" type="submit" onclick="return confirm('Hapus campaign #${c.id}?')">Hapus</button></form>
 </td></tr>`,
  )
  .join('')}
</tbody></table>
${pager(opts.filters, opts.page ?? 1, opts.perPage ?? 25, opts.total ?? campaigns.length)}`;
  return layout('Campaign', body);
}

export function blocklistPage(entries: string[], opts: PageOpts): string {
  const body = `
<h3>Blocklist</h3>
${opts.flash ? `<div class="flash">${esc(opts.flash)}</div>` : ''}
<form method="post" action="/blocklist/add" class="bar">
 <input type="text" name="value" placeholder="kata atau domain" style="width:260px"/>
 <button type="submit">Tambah</button>
</form>
<pre>${esc(entries.join('\n'))}</pre>
<p class="muted">Edit langsung di file <code>blocklist.txt</code> juga bisa.</p>`;
  return layout('Blocklist', body);
}

export function rejectedPage(rows: Array<{ id: number; name: string | null; source: string | null; reason: string | null; created_at: string }>, opts: PageOpts): string {
  const body = `
<h3>Rejected (yang dibuang filter)</h3>
<p class="muted">Untuk menyetel blocklist & filter agar tidak membuang lead yang benar.</p>
<table> <thead><tr><th>#</th><th>Nama</th><th>Sumber</th><th>Alasan</th><th>Waktu</th></tr></thead><tbody>
${rows
  .map(
    (r) =>
      `<tr><td data-label="#">${r.id}</td><td data-label="Nama">${esc(r.name)}</td><td data-label="Sumber">${esc(r.source)}</td><td data-label="Alasan" class="muted">${esc(r.reason)}</td><td data-label="Waktu" class="muted">${esc(r.created_at)}</td></tr>`,
  )
  .join('')}
</tbody></table>
${pager(opts.filters, opts.page ?? 1, opts.perPage ?? 25, opts.total ?? rows.length)}`;
  return layout('Rejected', body);
}

export function statsPage(
  s: {
    leads: number;
    withPhone: number;
    scored: number;
    contacted: number;
    dnc: number;
    rejected: number;
    bySource: Array<{ source: string; n: number }>;
    byCampaign: Array<{ keyword: string; lead_count: number; withPhone: number }>;
  },
  opts: PageOpts,
): string {
  const body = `
<h3>Stats</h3>
<table><tbody>
<tr><td>Total lead</td><td><b>${s.leads}</b></td></tr>
<tr><td>Punya nomor</td><td><b>${s.withPhone}</b></td></tr>
<tr><td>Sudah diskor</td><td>${s.scored}</td></tr>
<tr><td>Sudah dihubungi</td><td>${s.contacted}</td></tr>
<tr><td>DNC</td><td>${s.dnc}</td></tr>
<tr><td>Rejected (dibuang filter)</td><td>${s.rejected}</td></tr>
</tbody></table>
<h4>Per sumber</h4>
<table><thead><tr><th>Sumber</th><th>Lead</th></tr></thead><tbody>
${s.bySource.map((x) => `<tr><td>${esc(x.source)}</td><td>${x.n}</td></tr>`).join('')}
</tbody></table>
<h4>Per campaign</h4>
<table><thead><tr><th>Keyword</th><th>Lead</th><th>Punya nomor</th></tr></thead><tbody>
${s.byCampaign.map((x) => `<tr><td>${esc(x.keyword)}</td><td>${x.lead_count}</td><td>${x.withPhone}</td></tr>`).join('')}
</tbody></table>`;
  return layout('Stats', body);
}
