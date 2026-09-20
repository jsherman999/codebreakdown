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
export type Analysis = { summary: string; steps: Step[] };
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
