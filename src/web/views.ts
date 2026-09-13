import type { LeadRecord } from '../types.ts';

type Row = LeadRecord & { score: number | null; reason: string | null; segment: string | null };

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<script src="https://unpkg.com/htmx.org@1.9.12"></script>
<style>
 body{font:14px/1.4 system-ui,sans-serif;margin:0;background:#0f1115;color:#e6e6e6}
 header{padding:12px 16px;background:#171a21;display:flex;gap:16px;align-items:center;border-bottom:1px solid #262b36}
 header a{color:#9ecbff;text-decoration:none}
 main{padding:16px}
 table{border-collapse:collapse;width:100%}
 th,td{border-bottom:1px solid #262b36;padding:6px 8px;text-align:left;vertical-align:top}
 th{position:sticky;top:0;background:#171a21}
 tr:hover{background:#151922}
 .score{font-weight:700}
 .ok{color:#7ee787}.mid{color:#e3b341}.low{color:#8b949e}
 button{background:#238636;border:0;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer}
 .muted{color:#8b949e}
 textarea{width:100%;min-height:70px;background:#0f1115;color:#e6e6e6;border:1px solid #30363d;border-radius:6px;padding:8px}
 form{margin:0}
</style></head><body>
<header>
 <strong>ig-selling</strong>
 <a href="/">Leads</a>
 <a href="/messages">Drafts</a>
 <a href="/replies">Balasan</a>
 <a href="/export.csv">Export CSV</a>
 <span class="muted" style="margin-left:auto">Fase 2 — kirim via Baileys</span>
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

export function leadsPage(rows: Row[]): string {
  const body = `
<form method="post" action="/draft">
<p><button type="submit">Buat draft untuk yang dicentang</button> <span class="muted">hanya lead berskor &ge; MIN_SCORE</span></p>
<table>
<thead><tr><th></th><th>Skor</th><th>Nama</th><th>Nomor</th><th>Sumber</th><th>Kota</th><th>Alasan</th></tr></thead>
<tbody>
${rows
  .map(
    (r) => `<tr>
 <td><input type="checkbox" name="ids" value="${r.id}" ${r.score != null && r.score >= 60 ? 'checked' : ''}/></td>
 <td class="score ${scoreClass(r.score)}">${r.score ?? '-'}</td>
 <td>${esc(r.name)}${r.handle ? ` <span class="muted">@${esc(r.handle)}</span>` : ''}</td>
 <td>${r.phone ? `<a href="https://wa.me/${esc(r.phone.replace(/^\+/, ''))}" target="_blank">${esc(r.phone)}</a>` : '<span class="muted">-</span>'}</td>
 <td>${esc(r.source)}</td>
 <td>${esc(r.city)}</td>
 <td class="muted">${esc(r.reason)}</td>
</tr>`,
  )
  .join('')}
</tbody></table>
<p class="muted">${rows.length} lead</p>`;
  return layout('Leads', body);
}

export function messagesPage(rows: Array<{ id: number; lead_id: number; body: string; status: string; error: string | null; name: string | null; phone: string | null }>): string {
  const body = `
<form method="post" action="/approve" style="margin-bottom:12px">
<button type="submit" name="all" value="1">Approve semua draft (skor &ge; MIN_SCORE)</button>
</form>
<table>
<thead><tr><th>#</th><th>Lead</th><th>Nomor</th><th>Status</th><th>Pesan</th><th></th></tr></thead>
<tbody>
${rows
  .map(
    (r) => `<tr>
 <td>${r.id}</td>
 <td>${esc(r.name)}</td>
 <td>${esc(r.phone)}</td>
 <td>${esc(r.status)}${r.error ? ` <span class="muted">(${esc(r.error)})</span>` : ''}</td>
 <td><textarea readonly>${esc(r.body)}</textarea></td>
 <td>${
   r.status === 'draft'
     ? `<form method="post" action="/approve"><input type="hidden" name="id" value="${r.id}"/><button type="submit">Approve</button></form>`
     : ''
 }</td>
</tr>`,
  )
  .join('')}
</tbody></table>
<p class="muted">${rows.length} pesan. Kirim aktual lewat <code>npm run wa</code> (Baileys).</p>`;
  return layout('Drafts', body);
}

export function repliesPage(rows: Array<{ id: number; from_jid: string; body: string; is_optout: number; created_at: string; name: string | null }>): string {
  const body = `
<table>
<thead><tr><th>#</th><th>Waktu</th><th>Lead</th><th>JID</th><th>Opt-out</th><th>Pesan</th></tr></thead>
<tbody>
${rows
  .map(
    (r) => `<tr>
 <td>${r.id}</td>
 <td>${esc(r.created_at)}</td>
 <td>${esc(r.name)}</td>
 <td>${esc(r.from_jid)}</td>
 <td>${r.is_optout ? '<span class="ok">ya</span>' : ''}</td>
 <td>${esc(r.body)}</td>
</tr>`,
  )
  .join('')}
</tbody></table>
<p class="muted">${rows.length} balasan. Yang berisi STOP otomatis masuk suppression list.</p>`;
  return layout('Balasan', body);
}
