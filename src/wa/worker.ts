import makeWASocketDefault, {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  Browsers,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from '../config.ts';
import { addSuppression, findLeadByPhone, recordReply } from '../db/index.ts';
import { sendApproved } from './sender.ts';

type Sock = ReturnType<typeof makeWASocket>;
void makeWASocketDefault;

let sock: Sock | null = null;

type Incoming = {
  key?: { fromMe?: boolean; remoteJid?: string | null };
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
  };
};

function extractText(msg: Incoming): string {
  const m = msg.message;
  if (!m) return '';
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '';
}

function jidToPhone(jid: string): string {
  const digits = jidNormalizedUser(jid)
    .split('@')[0]
    .replace(/\D/g, '');
  return '+' + digits;
}

function handleIncoming(msg: Incoming): void {
  if (msg.key?.fromMe) return;
  const jid = msg.key?.remoteJid;
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;
  const body = extractText(msg);
  if (!body) return;

  const phone = jidToPhone(jid);
  const lead = findLeadByPhone(phone);
  const optout = /\b(stop|berhenti|jangan hubungi|jangan chat|unsubscribe)\b/i.test(body);
  recordReply(lead?.id ?? null, jid, body, optout);
  if (optout) addSuppression(phone, 'opt-out reply');
  console.log(`[wa] balasan ${phone}${lead ? ` (${lead.name})` : ''}: ${body.slice(0, 80)}${optout ? ' [OPT-OUT]' : ''}`);
}

async function start(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(config.wa.authDir);
  const version = await fetchLatestBaileysVersion()
    .then((v) => v.version)
    .catch(() => undefined);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages as unknown as Incoming[]) handleIncoming(m);
  });

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('[wa] scan QR ini di WhatsApp > Perangkat tertaut:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') console.log('[wa] terhubung');
    if (connection === 'close') {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error('[wa] logout. Hapus folder data/wa-auth lalu jalankan ulang untuk scan.');
        process.exit(1);
      }
      console.log('[wa] koneksi putus, reconnect 3s...');
      setTimeout(() => void start(), 3000);
    }
  });

  const tick = async (): Promise<void> => {
    try {
      if (sock) await sendApproved(sock);
    } catch (err) {
      console.warn(`[wa] loop error: ${(err as Error).message}`);
    }
  };
  setInterval(() => void tick(), config.wa.pollMs);
  await tick();
}

console.log(`[wa] mulai. Cap harian ${config.dailySendCap}. Hanya pesan berstatus approved yang dikirim.`);
start().catch((err) => {
  console.error(err);
  process.exit(1);
});
