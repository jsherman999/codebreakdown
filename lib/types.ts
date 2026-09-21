export type Provider = 'openai' | 'anthropic' | 'gemini' | 'openrouter';
export type SourceFile = {
  path: string;
  content?: string;
  sha?: string;
  size?: number;
};
export type Step = {
  title: string;
  explanation: string;
  startLine: number;
  endLine: number;
  path?: string;
};
export type Analysis = { summary: string; steps: Step[]; usage?: Usage[] };
export function detectProvider(key: string): Provider | '' {
  if (key.startsWith('sk-or-v1-')) return 'openrouter';
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-proj-') || key.startsWith('sk-svcacct-'))
    return 'openai';
  return '';
}
export const MAX_FILE_BYTES = 120_000;
export const MAX_FILES = 1500;

export type ModelInfo = {
  id: string;
  name: string;
  contextWindow?: number;
  inputLimit?: number;
  outputLimit?: number;
  pricing?: {
    input: number;
    output: number;
    cachedInput?: number;
    request?: number;
  };
};
export type Usage = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  costUsd: number | null;
  costSource: 'reported' | 'estimated' | 'unavailable';
  capacity: number | null;
  capacityKind: 'context' | 'input';
  capacityUsed: number | null;
  availableTokens: number | null;
  outputCap: number;
  finishReason: string;
};
export type RepoIntro = {
  summary: string;
  sources: string[];
  omittedFiles: number;
  usage?: Usage[];
};
export const REPOSITORY_BATCH_SIZE = 12;
