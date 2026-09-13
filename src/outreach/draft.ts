import { config, hasAI } from '../config.ts';
import type { LeadRecord } from '../types.ts';
import { chatJSON } from '../ai/client.ts';
import { fillTemplate, templateFor } from './templates.ts';

export async function draftMessage(lead: LeadRecord, templateId?: string | null): Promise<string> {
  const tpl = templateFor(templateId);
  const vars: Record<string, string> = {
    nama: lead.name || lead.handle || 'kak',
    kota: lead.city || 'Indonesia',
    offer: config.offer,
    segment: 'tim',
  };
  const fallback = fillTemplate(tpl.body, vars);
  if (!hasAI) return fallback;

  const system = [
    'Kamu menulis pesan WhatsApp pertama (cold outreach) Bahasa Indonesia untuk admin tim olahraga.',
    'Aturan: sopan, singkat (maks 3 kalimat), tidak spam, ada opsi opt-out kalimat terakhir.',
    'Balas HANYA JSON: {"text":string}.',
  ].join(' ');
  const lead_info = JSON.stringify({
    nama: vars.nama,
    kota: vars.kota,
    bio: (lead.bio ?? '').slice(0, 250),
    segment: tpl.label,
    offer: config.offer,
  });

  try {
    const out = await chatJSON<{ text?: string }>(system, `Draf kasar:\n${fallback}\n\nData lead:\n${lead_info}`);
    return (out.text ?? fallback).trim() || fallback;
  } catch (err) {
    console.warn(`[ai] draft gagal, pakai template: ${(err as Error).message}`);
    return fallback;
  }
}
