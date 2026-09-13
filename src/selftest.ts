import assert from 'node:assert/strict';
import { normalizePhone, extractPhones, extractEmails, extractWhatsAppNumbers } from './enrich/phone.ts';
import { decodeInstagramWrapper, isAggregator, extractChildLinks } from './enrich/link-resolve.ts';
import { heuristicExpand } from './ai/expand.ts';
import { fillTemplate, templateFor } from './outreach/templates.ts';

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

console.log(`\n${pass} check lulus${process.exitCode ? ' (ada gagal)' : ''}`);
