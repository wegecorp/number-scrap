import { existsSync } from 'node:fs';

try {
  if (existsSync('.env')) (process as unknown as { loadEnvFile(p: string): void }).loadEnvFile('.env');
} catch {
  // ponytail: env optional, no dotenv dep
}

function env(name: string, def = ''): string {
  return (process.env[name] ?? '').trim() || def;
}

export const config = {
  dbPath: env('DB_PATH', 'data/app.db'),
  port: Number(env('PORT', '3000')),
  defaultCountry: env('DEFAULT_COUNTRY', 'ID'),
  region: env('REGION', 'ID'),
  language: env('LANGUAGE', 'id'),
  dailySendCap: Number(env('DAILY_SEND_CAP', '15')),
  minScore: Number(env('MIN_SCORE', '60')),
  offer: env('OFFER', 'perlengkapan tim olahraga'),
  searchProvider: env('SEARCH_PROVIDER', 'duckduckgo'),
  googleCseKey: env('GOOGLE_CSE_KEY'),
  googleCseCx: env('GOOGLE_CSE_CX'),
  googleMapsKey: env('GOOGLE_MAPS_API_KEY'),
  igSessionId: env('IG_SESSIONID'),
  wa: {
    authDir: env('WA_AUTH_DIR', 'data/wa-auth'),
    minDelayMs: Number(env('WA_MIN_DELAY_MS', '60000')),
    maxDelayMs: Number(env('WA_MAX_DELAY_MS', '120000')),
    pollMs: Number(env('WA_POLL_MS', '30000')),
  },
  ai: {
    key: env('AI_API_KEY'),
    baseUrl: env('AI_BASE_URL', 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: env('AI_MODEL', 'deepseek-chat'),
  },
};

export const hasAI = config.ai.key.length > 0;
export const hasMaps = config.googleMapsKey.length > 0;
