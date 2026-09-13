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

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
 body{font:14px/1.4 system-ui,sans-serif;margin:0;background:#0f1115;color:#e6e6e6}
 header{padding:12px 16px;background:#171a21;display:flex;gap:14px;align-items:center;border-bottom:1px solid #262b36;flex-wrap:wrap}
 header a{color:#9ecbff;text-decoration:none}
 main{padding:16px;max-width:1200px}
 table{border-collapse:collapse;width:100%}
 th,td{border-bottom:1px solid #262b36;padding:6px 8px;text-align:left;vertical-align:top}
 th{position:sticky;top:0;background:#171a21}
 tr:hover{background:#151922}
 .score{font-weight:700}.ok{color:#7ee787}.mid{color:#e3b341}.low{color:#8b949e}
 button{background:#238636;border:0;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;margin:1px}
 button.ghost{background:#30363d}button.danger{background:#8b2d2d}
 a.chat{display:inline-block;background:#075e54;color:#fff;padding:6px 12px;border-radius:6px;text-decoration:none}
 .muted{color:#8b949e}.msg{max-width:320px;white-space:pre-wrap}
 form{display:inline;margin:0}
 .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;background:#141821;padding:10px;border-radius:8px}
 input,select,textarea{background:#0f1115;color:#e6e6e6;border:1px solid #30363d;border-radius:6px;padding:6px 8px;font:inherit}
 pre{background:#0f1115;border:1px solid #262b36;padding:10px;border-radius:8px;max-height:320px;overflow:auto;white-space:pre-wrap}
 .spin{display:inline-block;width:14px;height:14px;border:2px solid #30363d;border-top-color:#7ee787;border-radius:50%;animation:s 1s linear infinite;vertical-align:-2px}
 @keyframes s{to{transform:rotate(360deg)}}
 .flash{background:#173325;border:1px solid #2ea043;padding:8px 10px;border-radius:8px;margin-bottom:12px}
</style></head><body>
<header>
 <strong>number-scrap</strong>
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

  const body = `
${opts.flash ? `<div class="flash">${esc(opts.flash)}</div>` : ''}
${opts.running ? `<p><span class="spin"></span> Job #${opts.running.id} berjalan — <a href="/pipeline">lihat progres</a></p>` : ''}
<form method="get" action="/" class="bar">
 <input type="search" name="q" placeholder="cari nama/nomor/kota" value="${esc(f.q)}"/>
 <select name="source"><option value="">semua sumber</option>${sourceOptions}</select>
 <select name="campaign"><option value="">semua campaign</option>${campaignOptions}</select>
 <input type="number" name="min_score" min="0" max="100" placeholder="min skor" value="${f.minScore || ''}" style="width:90px"/>
 <label><input type="checkbox" name="new" value="1" ${f.onlyNew ? 'checked' : ''}/> belum dihubungi</label>
 <button type="submit">Filter</button>
 <a href="/" class="muted">reset</a>
 <a href="${esc(exportHref)}" class="muted">export CSV (sesuai filter)</a>
</form>
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
<form method="post" action="/bulk">
<p>
 <button type="submit" name="action" value="contacted">Tandai terpilih</button>
 <button type="submit" name="action" value="delete" class="danger" onclick="return confirm('Hapus permanen yang terpilih?')">Hapus terpilih</button>
 <button type="submit" name="action" value="block" class="ghost" onclick="return confirm('Blokir & hapus yang terpilih?')">Blokir terpilih</button>
</p>
<table>
<thead><tr><th></th><th>Skor</th><th>Nama</th><th>Nomor</th><th>Sumber</th><th>Kota</th><th>Campaign</th><th>Pesan</th><th>Aksi</th></tr></thead>
<tbody>
${rows
  .map(
    (r) => `<tr>
 <td><input type="checkbox" name="ids" value="${r.id}"/></td>
 <td class="score ${scoreClass(r.score)}">${r.score ?? '-'}</td>
 <td>${esc(r.name)}${r.handle ? ` <span class="muted">@${esc(r.handle)}</span>` : ''}</td>
 <td>${r.phone ? esc(r.phone) : '<span class="muted">-</span>'}</td>
 <td>${esc(r.source)}</td>
 <td>${esc(r.city)}</td>
 <td class="muted">${esc(r.campaign ?? '')}</td>
 <td class="msg muted">${esc(r.suggested_message ?? '')}</td>
 <td>
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
<p class="muted">${rows.length} lead ditampilkan</p>`;
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
 <td>${c.id}</td>
 <td>${esc(c.keyword)}</td>
 <td>${c.lead_count}</td>
 <td class="muted">${esc(c.created_at)}</td>
 <td>
  <a class="chat" href="/?campaign=${c.id}">Lihat lead</a>
  <a class="muted" href="/pipeline">jalankan lagi</a>
  <form method="post" action="/campaigns/delete"><input type="hidden" name="id" value="${c.id}"/><button class="danger" type="submit" onclick="return confirm('Hapus campaign #${c.id}?')">Hapus</button></form>
 </td></tr>`,
  )
  .join('')}
</tbody></table>`;
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
<table><thead><tr><th>#</th><th>Nama</th><th>Sumber</th><th>Alasan</th><th>Waktu</th></tr></thead><tbody>
${rows
  .map((r) => `<tr><td>${r.id}</td><td>${esc(r.name)}</td><td>${esc(r.source)}</td><td class="muted">${esc(r.reason)}</td><td class="muted">${esc(r.created_at)}</td></tr>`)
  .join('')}
</tbody></table>`;
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
