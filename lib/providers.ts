import type { Provider } from './types';
import { AppError, upstream, readJson } from './server';

type Part = {
  type?: string;
  text?: string;
  thought?: boolean;
  content?: Part[];
};
type Model = {
  id: string;
  name: string;
  display_name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
};
type ProviderResponse = {
  data?: Model[];
  models?: Model[];
  has_more?: boolean;
  last_id?: string;
  nextPageToken?: string;
  status?: string;
  stop_reason?: string;
  output?: Part[];
  content?: Part[];
  candidates?: { finishReason?: string; content?: { parts?: Part[] } }[];
};
const bases = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};
function headers(provider: Provider, key: string): Record<string, string> {
  if (provider === 'anthropic')
    return {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
  if (provider === 'gemini')
    return { 'x-goog-api-key': key, 'Content-Type': 'application/json' };
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
export async function listModels(
  provider: Provider,
  key: string,
  signal?: AbortSignal,
) {
  const models: { id: string; name: string }[] = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const query =
      provider === 'anthropic'
        ? `?limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}`
        : provider === 'gemini'
          ? `?pageSize=100${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`
          : '';
    const r = await upstream(
      `${bases[provider]}/models${query}`,
      { headers: headers(provider, key) },
      signal,
    );
    const data = await readJson<ProviderResponse>(r);
    for (const m of data.data || data.models || []) {
      if (provider === 'gemini') {
        if (
          m.supportedGenerationMethods?.includes('generateContent') &&
          !/image|tts|robotics|embedding/i.test(m.name)
        )
          models.push({
            id: m.name.replace(/^models\//, ''),
            name: m.displayName || m.name,
          });
      } else if (
        provider === 'anthropic' ||
        (/^(gpt-|o[134](?:-|$)|chatgpt-)/.test(m.id) &&
          !/audio|realtime|transcrib|image|tts|search|instruct/.test(m.id) &&
          !/^(gpt-3|gpt-4(?:-|$)|o1-mini|o1-preview|chatgpt-)/.test(m.id))
      ) {
        models.push({ id: m.id, name: m.display_name || m.id });
      }
    }
    cursor =
      (provider === 'anthropic' && data.has_more
        ? data.last_id
        : provider === 'gemini'
          ? data.nextPageToken
          : '') || '';
    if (!cursor) break;
  }
  if (!models.length)
    throw new AppError(
      'No compatible text-generation models are available for this key.',
      422,
    );
  return [...new Map(models.map((m) => [m.id, m])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
export async function generate(
  provider: Provider,
  key: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  let endpoint: string;
  let payload: Record<string, unknown>;
  if (provider === 'openai') {
    endpoint = '/responses';
    payload = { model, input: prompt, max_output_tokens: 12000, store: false };
  } else if (provider === 'anthropic') {
    endpoint = '/messages';
    payload = {
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    };
  } else {
    endpoint = `/models/${encodeURIComponent(model)}:generateContent`;
    payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 12000,
      },
    };
  }
  const r = await upstream(
    `${bases[provider]}${endpoint}`,
    {
      method: 'POST',
      headers: headers(provider, key),
      body: JSON.stringify(payload),
    },
    signal,
  );
  const data = await readJson<ProviderResponse>(r);
  let text = '';
  if (provider === 'openai') {
    if (data.status === 'incomplete')
      throw new AppError(
        'The model ran out of output space. Try another model or a smaller file.',
        422,
      );
    text = (data.output || [])
      .flatMap((x: Part) => x.content || [])
      .filter((x: Part) => x.type === 'output_text')
      .map((x: Part) => x.text || '')
      .join('');
  } else if (provider === 'anthropic') {
    if (data.stop_reason === 'max_tokens')
      throw new AppError(
        'The model ran out of output space. Try another model or a smaller file.',
        422,
      );
    text = (data.content || [])
      .filter((x: Part) => x.type === 'text')
      .map((x: Part) => x.text || '')
      .join('');
  } else {
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP')
      throw new AppError(
        'The model did not complete its response. Try another model or a smaller file.',
        422,
      );
    text = (candidate?.content?.parts || [])
      .filter((x: Part) => !x.thought)
      .map((x: Part) => x.text || '')
      .join('');
  }
  if (!text)
    throw new AppError(
      'The model returned no explanation. Try another model.',
      422,
    );
  return text;
}
