export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export async function getText(url: string, timeoutMs = 15000): Promise<{ finalUrl: string; html: string; status: number }> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { finalUrl: res.url || url, html: await res.text(), status: res.status };
}
