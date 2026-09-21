import type { SourceFile } from './types';
export const REPO_INTRO_PROMPT =
  'read and understand this repo/app. describe it in clear terms, what it does, what it is.';
export function selectIntroFiles(files: SourceFile[]) {
  function score(path: string) {
    if (
      /(^|\/)(node_modules|vendor|dist|build|\.git)\//i.test(path) ||
      /(^|\/)(\.env|credentials|secrets?)(\.|\/|$)|\.(pem|key|lock)$/i.test(
        path,
      )
    )
      return 100;
    if (/^readme(?:\.[\w-]+)?$/i.test(path)) return 0;
    if (
      /^(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|composer\.json|Gemfile)$/i.test(
        path,
      )
    )
      return 1;
    if (
      /(^|\/)(main|app|index|server|page)\.(py|tsx?|jsx?|rs|go|java|rb)$/i.test(
        path,
      )
    )
      return 2;
    if (/^docs\/[^/]+\.md$/i.test(path)) return 3;
    if (/\.(py|tsx?|jsx?|rs|go|java|rb|md)$/i.test(path)) return 4;
    return 100;
  }
  return files
    .filter((f) => (f.size ?? 0) <= 120_000 && score(f.path) < 100)
    .sort(
      (a, b) =>
        score(a.path) - score(b.path) ||
        a.path.split('/').length - b.path.split('/').length ||
        a.path.localeCompare(b.path),
    )
    .slice(0, 5);
}
