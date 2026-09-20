import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
writeFileSync('.test-build/package.json', '{"type":"commonjs"}\n');
const result = spawnSync(process.execPath, ['--test', 'tests/core.test.mjs'], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
