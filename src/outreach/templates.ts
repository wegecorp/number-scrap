export type Template = { id: string; label: string; body: string };

export const TEMPLATES: Record<string, Template> = {
  t_umum: {
    id: 't_umum',
    label: 'Umum',
    body:
      'Halo {nama}, saya lihat {nama} aktif di {kota}. Kami menyediakan {offer} untuk tim olahraga. ' +
      'Boleh saya kirim katalog singkatnya? Kalau tidak berkenan, cukup balas STOP.',
  },
  t_jersey: {
    id: 't_jersey',
    label: 'Jersey & seragam',
    body:
      'Halo admin {nama}, dari {kota} ya? Kami produksi jersey custom untuk tim/akademi. ' +
      'Untuk {nama} bisa kami kasih harga khusus. Mau saya kirim contoh desain + harga? Balas STOP kalau tidak mau dihubungi.',
  },
  t_alat: {
    id: 't_alat',
    label: 'Alat & perlengkapan',
    body:
      'Halo {nama}, kami supplier alat latihan (bola, cone, rompi, gawang). Banyak {segment} di {kota} langganan. ' +
      'Boleh saya kirim daftar harga? Balas STOP kalau tidak berkenan.',
  },
  t_sponsor: {
    id: 't_sponsor',
    label: 'Sponsorship',
    body:
      'Halo {nama}, kami sedang cari tim di {kota} untuk kerja sama sponsorship. ' +
      'Kalau {nama} tertarik, saya kirim detailnya? Balas STOP kalau tidak mau dihubungi.',
  },
};

export function templateFor(id?: string | null): Template {
  return (id && TEMPLATES[id]) || TEMPLATES.t_umum;
}

export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}
