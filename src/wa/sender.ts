import type { makeWASocket } from '@whiskeysockets/baileys';
import { config } from '../config.ts';
import { approvedMessages, isSuppressed, markFailed, markSent, sentToday } from '../db/index.ts';

type Sock = ReturnType<typeof makeWASocket>;

export function toJid(phone: string): string {
  return phone.replace(/^\+/, '') + '@s.whatsapp.net';
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function randomDelay(): number {
  const { minDelayMs, maxDelayMs } = config.wa;
  return Math.floor(minDelayMs + Math.random() * Math.max(0, maxDelayMs - minDelayMs));
}

export async function sendApproved(sock: Sock): Promise<number> {
  const cap = config.dailySendCap;
  if (sentToday() >= cap) return 0;

  const pending = approvedMessages(10);
  let sent = 0;

  for (const m of pending) {
    if (sentToday() >= cap) break;
    if (isSuppressed(m.phone)) {
      markFailed(m.id, 'suppressed');
      continue;
    }
    const jid = toJid(m.phone as string);
    try {
      const check = (await sock.onWhatsApp(jid))?.[0];
      if (!check?.exists) {
        markFailed(m.id, 'not-on-wa');
        continue;
      }
      await sock.sendMessage(jid, { text: m.body });
      markSent(m.id);
      sent++;
      console.log(`[wa] terkirim -> ${m.phone} (${sentToday()}/${cap})`);
    } catch (err) {
      markFailed(m.id, (err as Error).message);
      console.warn(`[wa] gagal ${m.phone}: ${(err as Error).message}`);
    }
    if (sentToday() < cap) await sleep(randomDelay());
  }
  return sent;
}
