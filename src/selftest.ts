import assert from 'node:assert/strict';
import { normalizePhone, extractPhones, extractEmails, extractWhatsAppNumbers } from './enrich/phone.ts';
import { decodeInstagramWrapper, isAggregator, extractChildLinks } from './enrich/link-resolve.ts';
import { heuristicExpand } from './ai/expand.ts';
import { fillTemplate, templateFor } from './outreach/templates.ts';
import { chatLink } from './outreach/chat-link.ts';
import { mentionsFromBio, instaRecordToCandidate } from './discovery/adapters/instagram.ts';
import { mapOsmResult } from './discovery/adapters/osm.ts';
import { isSearchJunk } from './discovery/web-search.ts';

let pass = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`ok   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}\n  ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

test('normalizePhone: 08xx -> E.164', () => {
  assert.equal(normalizePhone('0812-3456-7890'), '+6281234567890');
});
test('normalizePhone: tolak sampah', () => {
  assert.equal(normalizePhone('123'), null);
});
test('extractWhatsAppNumbers dari wa.me', () => {
  assert.deepEqual(extractWhatsAppNumbers('chat wa.me/6281234567890'), ['+6281234567890']);
});
test('extractPhones gabung wa.me + nomor mentah, dedupe', () => {
  const out = extractPhones('wa.me/6281234567890 atau 0812 3456 7890');
  assert.deepEqual(out, ['+6281234567890']);
});
test('extractEmails', () => {
  assert.deepEqual(extractEmails('hubungi admin@ssbgaruda.id ya'), ['admin@ssbgaruda.id']);
});
test('decodeInstagramWrapper', () => {
  const wrapped = 'https://l.instagram.com/?u=https%3A%2F%2Fwa.me%2F6281234567890&e=x';
  assert.equal(decodeInstagramWrapper(wrapped), 'https://wa.me/6281234567890');
});
test('isAggregator', () => {
  assert.equal(isAggregator('https://linktr.ee/ssbgaruda'), true);
  assert.equal(isAggregator('https://ssbgaruda.id'), false);
});
test('extractChildLinks buang aset', () => {
  const html = `<a href="https://wa.me/6281234567890">wa</a><img src="x.png"><a href="https://linktr.ee/a">b</a>`;
  const links = extractChildLinks(html, 'https://linktr.ee/a');
  assert.deepEqual(links, ['https://wa.me/6281234567890', 'https://linktr.ee/a']);
});
test('heuristicExpand: SSB Bandung', () => {
  const q = heuristicExpand('SSB Bandung');
  assert.equal(q.city, 'bandung');
  assert.equal(q.targetType, 'ssb');
  assert.equal(q.tooBroad, false);
  assert.ok(q.googleQueries[0].includes('site:instagram.com'));
});
test('heuristicExpand: terlalu luas', () => {
  assert.equal(heuristicExpand('sepak bola').tooBroad, true);
});
test('fillTemplate', () => {
  assert.equal(fillTemplate('Halo {nama} di {kota}', { nama: 'SSB A', kota: 'Bogor' }), 'Halo SSB A di Bogor');
});
test('templateFor fallback', () => {
  assert.equal(templateFor('tidak-ada').id, 't_umum');
});
test('chatLink encode pesan + normalisasi nomor', () => {
  const link = chatLink('+62 812-3456-7890', 'Halo SSB A');
  assert.equal(link, 'https://wa.me/6281234567890?text=Halo%20SSB%20A');
});
test('chatLink tanpa pesan', () => {
  assert.equal(chatLink('081234567890', ''), 'https://wa.me/081234567890');
});
test('mentionsFromBio ambil tag, buang reserved', () => {
  const out = mentionsFromBio('Tim peserta @ssbgaruda @garuda_muda follow @p @reels');
  assert.deepEqual(out, ['ssbgaruda', 'garuda_muda']);
});
test('mapOsmResult: petakan phone/kota/source', () => {
  const c = mapOsmResult({
    osm_type: 'node',
    osm_id: 42,
    name: 'SSB Garuda',
    address: { city: 'Bandung' },
    extratags: { phone: '0812-3456-7890', website: 'https://ssbgaruda.id' },
  });
  assert.equal(c?.source, 'osm');
  assert.equal(c?.phone, '+6281234567890');
  assert.equal(c?.city, 'Bandung');
  assert.equal(c?.handle, 'osm:node:42');
});
test('mapOsmResult: tanpa nama -> null', () => {
  assert.equal(mapOsmResult({ osm_type: 'node', osm_id: 1 }), null);
});
test('isSearchJunk buang host pencarian, simpan situs biasa', () => {
  assert.equal(isSearchJunk('https://www.w3.org/TR/'), true);
  assert.equal(isSearchJunk('https://duckduckgo.com/'), true);
  assert.equal(isSearchJunk('https://web.archive.org/web/x'), true);
  assert.equal(isSearchJunk('https://ssbgaruda.id/kontak'), false);
});
test('instaRecordToCandidate: nomor, website, meta', () => {
  const c = instaRecordToCandidate({
    username: 'ssbgaruda',
    full_name: 'SSB Garuda',
    biography: 'SSB di Bandung',
    public_phone_number: '0812-3456-7890',
    external_url: 'https://linktr.ee/x',
    follower_count: 1200,
    is_business: true,
  });
  assert.equal(c.phone, '+6281234567890');
  assert.equal(c.website, 'https://linktr.ee/x');
  assert.equal((c.meta as { followers?: number }).followers, 1200);
});
test('instaRecordToCandidate: pakai bio_links kalau external_url kosong', () => {
  const c = instaRecordToCandidate({ username: 'a', bio_links: ['https://wa.me/6281234567890'] });
  assert.equal(c.website, 'https://wa.me/6281234567890');
});

console.log(`\n${pass} check lulus${process.exitCode ? ' (ada gagal)' : ''}`);
