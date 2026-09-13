import type { LeadRecord } from '../types.ts';

export function draftMessage(lead: LeadRecord): string {
  const nama = lead.name || lead.handle || 'kak';
  return `Halo ${nama}`;
}
