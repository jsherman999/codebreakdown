import type { ModelInfo, Provider, Usage } from './types';

type Numbers = Record<string, unknown>;
export function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
const object = (v: unknown): Numbers =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Numbers) : {};
const add = (a: number | null, b: number | null) =>
  a === null || b === null ? null : a + b;
export function sanitizeModelInfo(value: unknown): Partial<ModelInfo> {
  const m = object(value);
  const result: Partial<ModelInfo> = {};
  for (const name of ['contextWindow', 'inputLimit', 'outputLimit'] as const) {
    const n = amount(m[name]);
    if (n !== null && n >= 1 && n <= 100_000_000) result[name] = Math.floor(n);
  }
  const p = object(m.pricing);
  const input = amount(p.input),
    output = amount(p.output);
  if (input !== null && output !== null && input <= 1 && output <= 1) {
    result.pricing = { input, output };
    for (const k of ['cachedInput', 'request'] as const) {
      const n = amount(p[k]);
      if (n !== null && n <= 10) result.pricing[k] = n;
    }
  }
  return result;
}
export function normalizeUsage(
  provider: Provider,
  model: string,
  data: unknown,
  metadata: Partial<ModelInfo>,
  outputCap: number,
  finishReason: string,
): Usage {
  const body = object(data);
  const u = object(body.usage);
  const g = object(body.usageMetadata);
  let input = amount(u.input_tokens ?? u.prompt_tokens),
    output = amount(u.output_tokens ?? u.completion_tokens);
  let reasoning = amount(
    object(u.output_tokens_details ?? u.completion_tokens_details)
      .reasoning_tokens,
  );
  let cached = amount(
    object(u.input_tokens_details ?? u.prompt_tokens_details).cached_tokens,
  );
  if (provider === 'anthropic') {
    cached = amount(u.cache_read_input_tokens);
    if (input !== null)
      input += (cached ?? 0) + (amount(u.cache_creation_input_tokens) ?? 0);
  }
  if (provider === 'gemini') {
    input = amount(g.promptTokenCount);
    reasoning = amount(g.thoughtsTokenCount);
    output = amount(g.candidatesTokenCount);
    if (output !== null) output += reasoning ?? 0;
    else if (amount(g.totalTokenCount) !== null && input !== null)
      output = Math.max(0, Number(g.totalTokenCount) - input);
    cached = amount(g.cachedContentTokenCount);
  }
  const total =
    amount(provider === 'gemini' ? g.totalTokenCount : u.total_tokens) ??
    add(input, output);
  let costUsd = provider === 'openrouter' ? amount(u.cost) : null;
  let costSource: Usage['costSource'] =
    costUsd !== null ? 'reported' : 'unavailable';
  if (
    costUsd === null &&
    input !== null &&
    output !== null &&
    metadata.pricing
  ) {
    const p = metadata.pricing;
    const cache = Math.min(cached ?? 0, input);
    costUsd =
      (input - cache) * p.input +
      cache * (p.cachedInput ?? p.input) +
      output * p.output +
      (p.request ?? 0);
    costSource = 'estimated';
  }
  const capacity = metadata.contextWindow ?? metadata.inputLimit ?? null;
  const capacityKind = metadata.contextWindow ? 'context' : 'input';
  const capacityUsed = capacityKind === 'context' ? total : input;
  return {
    model,
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    reasoningTokens: reasoning,
    cachedTokens: cached,
    costUsd,
    costSource,
    capacity,
    capacityKind,
    capacityUsed,
    availableTokens:
      capacity !== null && capacityUsed !== null
        ? Math.max(0, capacity - capacityUsed)
        : null,
    outputCap,
    finishReason,
  };
}
export function usageTotals(records: Usage[]) {
  const sum = (
    key: 'inputTokens' | 'outputTokens' | 'totalTokens' | 'costUsd',
  ) =>
    records.every((r) => r[key] !== null)
      ? records.reduce((n, r) => n + (r[key] ?? 0), 0)
      : null;
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    totalTokens: sum('totalTokens'),
    costUsd: sum('costUsd'),
    estimated: records.some((r) => r.costSource === 'estimated'),
  };
}
