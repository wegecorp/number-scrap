import { config, hasAI } from '../config.ts';

export async function chatJSON<T>(system: string, user: string): Promise<T> {
  if (!hasAI) throw new Error('no-ai');
  const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.key}` },
    body: JSON.stringify({
      model: config.ai.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content ?? '{}';
  return parseJson<T>(text);
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI bukan JSON');
    return JSON.parse(m[0]) as T;
  }
}
