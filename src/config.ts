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
  dashUser: env('DASH_USER'),
  dashPass: env('DASH_PASS'),
  seedExpansion: Number(env('AI_SEED_EXPANSION', '1')),
  minScore: Number(env('MIN_SCORE', '60')),
  offer: env('OFFER', 'perlengkapan tim olahraga'),
  searchProvider: env('SEARCH_PROVIDER', 'auto'),
  searxngUrls: env('SEARXNG_URLS', env('SEARXNG_URL', 'https://opnxng.com,https://paulgo.io,https://searxng.site'))
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  searchDelayMs: Number(env('SEARCH_DELAY_MS', '1500')),
  googleCseKey: env('GOOGLE_CSE_KEY'),
  googleCseCx: env('GOOGLE_CSE_CX'),
  googleMapsKey: env('GOOGLE_MAPS_API_KEY'),
  igSessionId: env('IG_SESSIONID'),
  igFetchDelayMs: Number(env('IG_FETCH_DELAY_MS', '2500')),
  igBackend: env('IG_BACKEND', 'auto') as 'auto' | 'web' | 'instagrapi',
  pythonBin: env('PYTHON_BIN', process.platform === 'win32' ? 'ig/venv/Scripts/python.exe' : 'ig/venv/bin/python'),
  osmEnabled: env('OSM_ENABLED', '1') !== '0',
  osmUserAgent: env('OSM_UA', 'number-scrap/0.1 (+https://github.com/wegecorp/number-scrap)'),
  ai: {
    key: env('AI_API_KEY'),
    baseUrl: env('AI_BASE_URL', 'https://ai.sumopod.com/v1').replace(/\/+$/, ''),
    model: env('AI_MODEL', 'deepseek-v4-flash'),
    jsonMode: env('AI_JSON_MODE', 'auto') as 'auto' | 'on' | 'off',
  },
};

export const hasAI = config.ai.key.length > 0;
export const hasMaps = config.googleMapsKey.length > 0;
