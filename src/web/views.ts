import type { LeadRecord } from '../types.ts';
import { chatLink } from '../outreach/chat-link.ts';

type Row = LeadRecord & { score: number | null; reason: string | null; segment: string | null };

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
 button.ghost{background:#30363d}
 a.chat{display:inline-block;background:#075e54;color:#fff;padding:6px 12px;border-radius:6px;text-decoration:none}
 .muted{color:#8b949e}.msg{max-width:420px;white-space:pre-wrap}
 form{display:inline;margin:0}
</style></head><body>
<header>
 <strong>ig-selling</strong>
 <a href="/">Leads</a>
 <a href="/?filter=new">Belum dihubungi</a>
 <a href="/export.csv">Export CSV</a>
 <span class="muted" style="margin-left:auto">scraper — kirim manual via wa.me</span>
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

export function leadsPage(rows: Row[], filter: string): string {
  const body = `
<p>
 <form method="post" action="/draft"><button type="submit">Susun pesan untuk lead berskor</button></form>
 <span class="muted">&nbsp;hanya lead punya nomor &ge; MIN_SCORE, tanpa pesan</span>
</p>
<table>
<thead><tr><th>Skor</th><th>Nama</th><th>Nomor</th><th>Sumber</th><th>Kota</th><th>Pesan</th><th>Aksi</th></tr></thead>
<tbody>
${rows
  .map(
    (r) => `<tr>
 <td class="score ${scoreClass(r.score)}">${r.score ?? '-'}</td>
 <td>${esc(r.name)}${r.handle ? ` <span class="muted">@${esc(r.handle)}</span>` : ''}</td>
 <td>${r.phone ? esc(r.phone) : '<span class="muted">-</span>'}</td>
 <td>${esc(r.source)}</td>
 <td>${esc(r.city)}</td>
 <td class="msg muted">${esc(r.suggested_message ?? '')}</td>
 <td>
  ${r.phone && !r.contacted_at ? `<a class="chat" target="_blank" href="${esc(chatLink(r.phone, r.suggested_message))}">Chat</a>` : ''}
  ${
    r.contacted_at
      ? `<span class="ok">sudah dihubungi</span>`
      : `<form method="post" action="/contacted"><input type="hidden" name="id" value="${r.id}"/><button class="ghost" type="submit">Tandai</button></form>`
  }
 </td>
</tr>`,
  )
  .join('')}
</tbody></table>
<p class="muted">${rows.length} lead${filter === 'new' ? ' (belum dihubungi)' : ''}</p>`;
  return layout('Leads', body);
}
