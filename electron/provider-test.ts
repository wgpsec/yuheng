import type { ProviderConfig } from './store';

export type ProviderTestResult = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error?: string;
};

type FetchLike = typeof fetch;

function endpoint(config: ProviderConfig): string {
  const base = config.baseUrl.replace(/\/$/, '');
  return config.protocol === 'anthropic'
    ? `${base.endsWith('/v1') ? base : `${base}/v1`}/messages`
    : `${base}/chat/completions`;
}

function responseMessage(body: string, apiKey: string): string {
  try {
    const value: unknown = JSON.parse(body);
    if (value && typeof value === 'object') {
      const error = (value as { error?: unknown }).error;
      if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') return String((error as { message: string }).message).replaceAll(apiKey, '[redacted]').slice(0, 240);
      if (typeof (value as { message?: unknown }).message === 'string') return String((value as { message: string }).message).replaceAll(apiKey, '[redacted]').slice(0, 240);
    }
  } catch { /* Non-JSON provider errors use a generic message. */ }
  return 'Provider 返回了错误响应。';
}

export async function testProviderConnection(config: ProviderConfig, apiKey: string, fetchImpl: FetchLike = fetch, timeoutMs = 15_000): Promise<ProviderTestResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const body = config.protocol === 'anthropic'
      ? (headers['anthropic-version'] = '2023-06-01', headers['x-api-key'] = apiKey, JSON.stringify({ model: config.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }))
      : (headers.authorization = `Bearer ${apiKey}`, JSON.stringify({ model: config.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }));
    const response = await fetchImpl(endpoint(config), { method: 'POST', headers, body, signal: controller.signal });
    if (response.ok) return { ok: true, status: response.status, latencyMs: Date.now() - started };
    const text = await response.text().catch(() => '');
    return { ok: false, status: response.status, latencyMs: Date.now() - started, error: responseMessage(text, apiKey) };
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError' ? 'Provider 请求超时。' : error instanceof Error ? error.message.replaceAll(apiKey, '[redacted]').slice(0, 240) : '无法连接 Provider。';
    return { ok: false, status: null, latencyMs: Date.now() - started, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
