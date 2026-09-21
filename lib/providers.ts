import type { Provider, ModelInfo, Usage } from './types';
import { AppError, upstream, readJson } from './server';
import { normalizeUsage } from './usage';

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
  context_length?: number;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  max_input_tokens?: number;
  max_tokens?: number;
  top_provider?: { context_length?: number; max_completion_tokens?: number };
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    request?: string;
  };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
};
type ProviderResponse = {
  data?: Model[];
  models?: Model[];
  has_more?: boolean;
  last_id?: string;
  nextPageToken?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  stop_reason?: string;
  error?: { code?: number };
  choices?: {
    finish_reason?: string;
    error?: { code?: number };
    message?: { content?: string | Part[] | null };
  }[];
  output?: Part[];
  content?: Part[];
  candidates?: { finishReason?: string; content?: { parts?: Part[] } }[];
};
const bases = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
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
  if (provider === 'openrouter') {
    // Validate separately: a public model catalog is not proof that a key works.
    const validation = await upstream(
      `${bases.openrouter}/key`,
      { headers: headers(provider, key) },
      signal,
    );
    await validation.body?.cancel();
  }
  const models: ModelInfo[] = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const query =
      provider === 'anthropic'
        ? `?limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}`
        : provider === 'gemini'
          ? `?pageSize=100${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`
          : '';
    const r = await upstream(
      `${bases[provider]}/models${provider === 'openrouter' ? '/user' : ''}${query}`,
      { headers: headers(provider, key) },
      signal,
    );
    const data = await readJson<ProviderResponse>(
      r,
      provider === 'openrouter' ? 8_000_000 : 2_000_000,
    );
    for (const m of data.data || data.models || []) {
      if (provider === 'openrouter') {
        if (
          m.architecture?.input_modalities?.includes('text') &&
          m.architecture.output_modalities?.includes('text')
        ) {
          const info: ModelInfo = { id: m.id, name: m.name || m.id };
          const context = m.top_provider?.context_length || m.context_length;
          if (context && context > 0) info.contextWindow = context;
          if (
            m.top_provider?.max_completion_tokens &&
            m.top_provider.max_completion_tokens > 0
          )
            info.outputLimit = m.top_provider.max_completion_tokens;
          const input =
              m.pricing?.prompt == null ? NaN : Number(m.pricing.prompt),
            output =
              m.pricing?.completion == null
                ? NaN
                : Number(m.pricing.completion);
          if (
            Number.isFinite(input) &&
            input >= 0 &&
            Number.isFinite(output) &&
            output >= 0
          ) {
            info.pricing = { input, output };
            if (
              m.pricing?.input_cache_read != null &&
              Number(m.pricing.input_cache_read) >= 0
            )
              info.pricing.cachedInput = Number(m.pricing.input_cache_read);
            if (m.pricing?.request != null && Number(m.pricing.request) >= 0)
              info.pricing.request = Number(m.pricing.request);
          }
          models.push(info);
        }
      } else if (provider === 'gemini') {
        if (
          m.supportedGenerationMethods?.includes('generateContent') &&
          !/image|tts|robotics|embedding/i.test(m.name)
        )
          models.push({
            id: m.name.replace(/^models\//, ''),
            name: m.displayName || m.name,
            ...(m.inputTokenLimit ? { inputLimit: m.inputTokenLimit } : {}),
            ...(m.outputTokenLimit ? { outputLimit: m.outputTokenLimit } : {}),
          });
      } else if (
        provider === 'anthropic' ||
        (/^(gpt-|o[134](?:-|$)|chatgpt-)/.test(m.id) &&
          !/audio|realtime|transcrib|image|tts|search|instruct/.test(m.id) &&
          !/^(gpt-3|gpt-4(?:-|$)|o1-mini|o1-preview|chatgpt-)/.test(m.id))
      ) {
        models.push({
          id: m.id,
          name: m.display_name || m.id,
          ...(m.max_input_tokens ? { inputLimit: m.max_input_tokens } : {}),
          ...(m.max_tokens ? { outputLimit: m.max_tokens } : {}),
        });
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
  options: {
    metadata?: Partial<ModelInfo>;
    onUsage?: (usage: Usage) => void;
    maxOutput?: number;
  } = {},
): Promise<string> {
  const metadata = options.metadata || {};
  let outputCap = Math.min(
    options.maxOutput ?? 12000,
    metadata.outputLimit ?? 12000,
  );
  const estimatedInput = Math.ceil(new TextEncoder().encode(prompt).length / 3);
  if (metadata.inputLimit && estimatedInput > metadata.inputLimit)
    throw new AppError(
      'Estimated input exceeds the model input limit. Choose a larger-context model.',
      422,
      'context_limit',
    );
  if (metadata.contextWindow)
    outputCap = Math.min(
      outputCap,
      metadata.contextWindow - estimatedInput - 512,
    );
  if (outputCap < 256)
    throw new AppError(
      'Estimated context capacity is too small for this request. Choose a larger-context model.',
      422,
      'context_limit',
    );
  let endpoint: string;
  let payload: Record<string, unknown>;
  if (provider === 'openai') {
    endpoint = '/responses';
    payload = {
      model,
      input: prompt,
      max_output_tokens: outputCap,
      store: false,
    };
  } else if (provider === 'openrouter') {
    endpoint = '/chat/completions';
    payload = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: outputCap,
      stream: false,
    };
  } else if (provider === 'anthropic') {
    endpoint = '/messages';
    payload = {
      model,
      max_tokens: outputCap,
      messages: [{ role: 'user', content: prompt }],
    };
  } else {
    endpoint = `/models/${encodeURIComponent(model)}:generateContent`;
    payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: outputCap,
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
    180_000,
  );
  const data = await readJson<ProviderResponse>(r);
  const rawReason =
    provider === 'openai'
      ? data.incomplete_details?.reason || data.status || 'completed'
      : provider === 'anthropic'
        ? data.stop_reason
        : provider === 'openrouter'
          ? data.choices?.[0]?.finish_reason
          : data.candidates?.[0]?.finishReason;
  const finishReason =
    typeof rawReason === 'string' && /^[a-zA-Z_]+$/.test(rawReason)
      ? rawReason
      : 'unknown';
  const usage = normalizeUsage(
    provider,
    model,
    data,
    metadata,
    outputCap,
    finishReason,
  );
  options.onUsage?.(usage);
  console.info(
    JSON.stringify({
      event: 'generation',
      time: new Date().toISOString(),
      provider,
      ...usage,
    }),
  );
  let text = '';
  if (provider === 'openai') {
    if (
      data.status === 'incomplete' &&
      data.incomplete_details?.reason &&
      data.incomplete_details.reason !== 'max_output_tokens'
    )
      throw new AppError(
        'The provider stopped the response before completion.',
        422,
        'provider_incomplete',
      );
    if (data.status === 'incomplete')
      throw new AppError(
        `The model reached its ${outputCap.toLocaleString()}-token output cap (including reasoning). Try a smaller section or another model.`,
        422,
        'output_limit',
      );
    text = (data.output || [])
      .flatMap((x: Part) => x.content || [])
      .filter((x: Part) => x.type === 'output_text')
      .map((x: Part) => x.text || '')
      .join('');
  } else if (provider === 'openrouter') {
    const choice = data.choices?.[0];
    if (data.error || choice?.error)
      throw new AppError(
        'OpenRouter could not complete the request. Check credits or choose another model.',
        502,
      );
    if (choice?.finish_reason === 'length')
      throw new AppError(
        `The model reached its ${outputCap.toLocaleString()}-token output cap (including reasoning). Try a smaller section or another model.`,
        422,
        'output_limit',
      );
    if (choice?.finish_reason && choice.finish_reason !== 'stop')
      throw new AppError(
        'The model did not complete its response. Try another model or a smaller file.',
        422,
      );
    const content = choice?.message?.content;
    text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((p) => p.type === 'text')
              .map((p) => p.text || '')
              .join('')
          : '';
  } else if (provider === 'anthropic') {
    if (data.stop_reason === 'max_tokens')
      throw new AppError(
        `The model reached its ${outputCap.toLocaleString()}-token output cap (including reasoning). Try a smaller section or another model.`,
        422,
        'output_limit',
      );
    text = (data.content || [])
      .filter((x: Part) => x.type === 'text')
      .map((x: Part) => x.text || '')
      .join('');
  } else {
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS')
      throw new AppError(
        `The model reached its ${outputCap.toLocaleString()}-token output cap (including reasoning). Try a smaller section or another model.`,
        422,
        'output_limit',
      );
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
