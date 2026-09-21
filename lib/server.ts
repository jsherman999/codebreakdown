import type { Provider } from './types';

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'request_error',
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export function failure(error: unknown) {
  if (error instanceof AppError)
    return json({ error: error.message }, error.status);
  if (error instanceof Error && /abort|timeout/i.test(error.name))
    return json(
      {
        error:
          'The request timed out or was canceled. Try again with a smaller file.',
      },
      504,
    );
  return json(
    { error: 'The request could not be completed. Please try again.' },
    500,
  );
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw new AppError('Cross-origin requests are not allowed.', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AppError('Expected a JSON request.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Missing request body.');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 400_000) {
      await reader.cancel();
      throw new AppError('Request exceeds the size limit.', 413);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
      throw new Error();
    return parsed;
  } catch {
    throw new AppError('Invalid JSON request.');
  }
}
export function string(value: unknown, name: string, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AppError(`Invalid ${name}.`);
  return value;
}
export function credentials(data: Record<string, unknown>): {
  key: string;
  provider: Provider;
} {
  const key = string(data.key, 'API key', 500).trim();
  if (
    !['openai', 'anthropic', 'gemini', 'openrouter'].includes(
      String(data.provider),
    )
  )
    throw new AppError('Select a supported provider.');
  if (/[\r\n]/.test(key)) throw new AppError('Invalid API key.');
  return { key, provider: data.provider as Provider };
}
export async function upstream(
  url: string,
  init: RequestInit = {},
  signal?: AbortSignal,
  timeoutMs = 90_000,
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }).catch((error) => {
    if (timeout.aborted && !signal?.aborted)
      throw new AppError(
        `Provider request exceeded ${timeoutMs / 1000} seconds.`,
        504,
        'timeout',
      );
    throw error;
  });
  if (!response.ok) {
    // Classify bounded upstream text locally, but never return or log raw messages.
    let contextError = false;
    if ([400, 413, 422].includes(response.status)) {
      try {
        const detail = await readJson<{
          error?: { code?: unknown; message?: unknown };
        }>(response, 16000);
        const reason = [detail.error?.code, detail.error?.message]
          .filter((v) => typeof v === 'string')
          .join(' ');
        contextError =
          /context[_ ]length|context[_ ]window|maximum.*context|input.*token.*limit|too many.*tokens/i.test(
            reason,
          );
      } catch {
        /* Preserve a safe HTTP-level error when the body is unreadable. */
      }
    } else await response.body?.cancel();
    if (contextError)
      throw new AppError(
        'The provider rejected this request because it exceeds the model context limit. Choose a larger-context model.',
        422,
        'context_limit',
      );
    if (response.status === 401 || response.status === 403)
      throw new AppError(
        'Access denied. Check your API key, provider, and model permissions.',
        401,
      );
    if (response.status === 402)
      throw new AppError(
        'Provider credits are insufficient. Check your account balance or choose a lower-cost model.',
        402,
      );
    if (response.status === 429)
      throw new AppError(
        'Provider rate limit or quota reached. Check billing or try again later.',
        429,
      );
    if (response.status === 404)
      throw new AppError(
        'The requested model or repository was not found.',
        404,
      );
    throw new AppError(
      `Provider request failed (${response.status}). Try a different model or a smaller input.`,
      502,
    );
  }
  return response;
}

export async function readJson<T>(
  response: Response,
  maxBytes = 2_000_000,
): Promise<T> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError('The upstream service returned an empty response.', 502);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new AppError(
        'The upstream response exceeds the size limit. Choose a smaller input.',
        413,
      );
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined)) as T;
  } catch {
    throw new AppError('The upstream service returned invalid JSON.', 502);
  }
}
