import { config, hasAI } from '../config.ts';

export class AIError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

type RunResult = { text: string; mode: 'json_object' | 'plain' };

async function request(system: string, user: string, useJsonMode: boolean): Promise<string> {
  const body: Record<string, unknown> = {
    model: config.ai.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
  };
  if (useJsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new AIError(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? '';
}

async function run(system: string, user: string): Promise<RunResult> {
  const mode = config.ai.jsonMode;
  if (mode === 'off') return { text: await request(system, user, false), mode: 'plain' };
  if (mode === 'on') return { text: await request(system, user, true), mode: 'json_object' };
  try {
    return { text: await request(system, user, true), mode: 'json_object' };
  } catch (err) {
    const status = err instanceof AIError ? err.status : undefined;
    if (status === 400 || status === 404 || status === 415 || status === 422) {
      console.warn(`[ai] json_object tidak didukung (${status}), ulangi tanpa response_format`);
      return { text: await request(system, user, false), mode: 'plain' };
    }
    throw err;
  }
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`AI bukan JSON: ${text.slice(0, 120)}`);
    return JSON.parse(m[0]) as T;
  }
}

export async function chatJSON<T>(system: string, user: string): Promise<T> {
  if (!hasAI) throw new Error('no-ai');
  return parseJson<T>((await run(system, user)).text);
}

export async function listModels(): Promise<string[]> {
  if (!hasAI) throw new Error('AI_API_KEY kosong di .env');
  const res = await fetch(`${config.ai.baseUrl}/models`, {
    headers: { authorization: `Bearer ${config.ai.key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new AIError(`models ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort();
}

export async function pingAI(): Promise<RunResult> {
  if (!hasAI) throw new Error('AI_API_KEY kosong di .env');
  return run('Balas HANYA JSON.', 'Balas tepat: {"ok":true}');
}
