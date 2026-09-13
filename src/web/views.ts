import type { LeadRecord } from '../types.ts';
import { chatLink } from '../outreach/chat-link.ts';

type Row = LeadRecord & { score: number | null; reason: string | null; segment: string | null; campaign?: string | null };

export type LeadsViewOpts = {
  campaigns: Array<{ id: number; keyword: string; lead_count: number }>;
  sources: string[];
  filters: { q: string; source: string; minScore: number; onlyNew: boolean; campaign: string };
  running?: { id: number; cmd: string } | null;
  jobLog?: string;
};

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
 body{font:14px/1.4 system-ui,sans-serif;margin:0;background:#0f1115;color:#e6e6e6}
 header{padding:12px 16px;background:#171a21;display:flex;gap:16px;align-items:center;border-bottom:1px solid #262b36;flex-wrap:wrap}
 header a{color:#9ecbff;text-decoration:none}
 main{padding:16px}
 table{border-collapse:collapse;width:100%}
 th,td{border-bottom:1px solid #262b36;padding:6px 8px;text-align:left;vertical-align:top}
 th{position:sticky;top:0;background:#171a21}
 tr:hover{background:#151922}
 .score{font-weight:700}.ok{color:#7ee787}.mid{color:#e3b341}.low{color:#8b949e}
 button{background:#238636;border:0;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer}
 button.ghost{background:#30363d}button.danger{background:#8b2d2d}
 a.chat{display:inline-block;background:#075e54;color:#fff;padding:6px 12px;border-radius:6px;text-decoration:none}
 .muted{color:#8b949e}.msg{max-width:340px;white-space:pre-wrap}
 form{display:inline;margin:0}
 .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;background:#141821;padding:10px;border-radius:8px}
 input,select{background:#0f1115;color:#e6e6e6;border:1px solid #30363d;border-radius:6px;padding:6px 8px}
 pre{background:#0f1115;border:1px solid #262b36;padding:10px;border-radius:8px;max-height:320px;overflow:auto;white-space:pre-wrap}
 .spin{display:inline-block;width:14px;height:14px;border:2px solid #30363d;border-top-color:#7ee787;border-radius:50%;animation:s 1s linear infinite;vertical-align:-2px}
 @keyframes s{to{transform:rotate(360deg)}}
</style></head><body>
<header>
 <strong>number-scrap</strong>
 <a href="/">Leads</a>
 <a href="/?new=1">Belum dihubungi</a>
 <a href="/run">Jalankan</a>
 <a href="/export.csv">Export CSV</a>
 <span class="muted" style="margin-left:auto">kirim manual via wa.me</span>
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

export function leadsPage(rows: Row[], opts: LeadsViewOpts): string {
  const f = opts.filters;
  const campaignOptions = opts.campaigns
    .map((c) => `<option value="${c.id}" ${f.campaign === String(c.id) ? 'selected' : ''}>${esc(c.keyword)} (${c.lead_count})</option>`)
    .join('');
  const sourceOptions = opts.sources.map((s) => `<option value="${esc(s)}" ${f.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('');

  const body = `
${opts.running ? `<p><span class="spin"></span> Job #${opts.running.id} sedang jalan — <a href="/run">lihat progres</a></p>` : ''}
<form method="get" action="/" class="bar">
 <input type="search" name="q" placeholder="cari nama/nomor/kota" value="${esc(f.q)}"/>
 <select name="source"><option value="">semua sumber</option>${sourceOptions}</select>
 <select name="campaign"><option value="">semua campaign</option>${campaignOptions}</select>
 <input type="number" name="min_score" min="0" max="100" placeholder="min skor" value="${f.minScore || ''}" style="width:90px"/>
 <label><input type="checkbox" name="new" value="1" ${f.onlyNew ? 'checked' : ''}/> belum dihubungi</label>
 <button type="submit">Filter</button>
 <a href="/" class="muted">reset</a>
</form>
<form method="post" action="/draft"><button type="submit">Susun pesan untuk lead berskor &ge; ${esc('MIN_SCORE')}</button></form>
<table>
<thead><tr><th>Skor</th><th>Nama</th><th>Nomor</th><th>Sumber</th><th>Kota</th><th>Campaign</th><th>Pesan</th><th>Aksi</th></tr></thead>
<tbody>
${rows
  .map(
    (r) => `<tr>
 <td class="score ${scoreClass(r.score)}">${r.score ?? '-'}</td>
 <td>${esc(r.name)}${r.handle ? ` <span class="muted">@${esc(r.handle)}</span>` : ''}</td>
 <td>${r.phone ? esc(r.phone) : '<span class="muted">-</span>'}</td>
 <td>${esc(r.source)}</td>
 <td>${esc(r.city)}</td>
 <td class="muted">${esc(r.campaign ?? '')}</td>
 <td class="msg muted">${esc(r.suggested_message ?? '')}</td>
 <td>
  ${r.phone && !r.contacted_at ? `<a class="chat" target="_blank" href="${esc(chatLink(r.phone, r.suggested_message))}">Chat</a>` : ''}
  ${r.contacted_at ? `<span class="ok">sudah dihubungi</span>` : `<form method="post" action="/contacted"><input type="hidden" name="id" value="${r.id}"/><button class="ghost" type="submit">Tandai</button></form>`}
  <form method="post" action="/block" onsubmit="return confirm('Blokir & hapus lead ini?')"><input type="hidden" name="id" value="${r.id}"/><button class="ghost" type="submit">Blokir</button></form>
  <form method="post" action="/delete" onsubmit="return confirm('Hapus permanen?')"><input type="hidden" name="id" value="${r.id}"/><button class="danger" type="submit">Hapus</button></form>
 </td>
</tr>`,
  )
  .join('')}
</tbody></table>
<p class="muted">${rows.length} lead ditampilkan</p>`;
  return layout('Leads', body);
}

export function runPage(opts: LeadsViewOpts): string {
  const running = opts.running;
  const body = `
<h3>Jalankan pipeline</h3>
${
  running
    ? `<p><span class="spin"></span> Job #${running.id} berjalan: <code>${esc(running.cmd)}</code></p>
       <p class="muted">Halaman ini auto-refresh. Jangan tutup.</p>`
    : `<form method="post" action="/run" class="bar">
 <textarea name="keywords" rows="5" cols="40" placeholder="SSB Bandung&#10;klub futsal Bandung"></textarea>
 <input type="number" name="limit" value="20" min="1" max="200" style="width:90px"/>
 <button type="submit">Cari + Skor + Susun</button>
</form>
<p class="muted">Satu keyword per baris. Proses jalan di latar belakang.</p>`
}
<h3>Log</h3>
<pre>${esc(opts.jobLog ?? '(belum ada log)')}</pre>
${running ? `<script>setTimeout(function(){ location.href='/run'; }, 3000);</script>` : ''}`;
  return layout('Jalankan', body);
}
