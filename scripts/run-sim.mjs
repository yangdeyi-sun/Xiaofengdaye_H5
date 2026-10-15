import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [name = 'sim', ...args] = process.argv.slice(2);
if (!['sim', 'perf'].includes(name)) {
  console.error('仅支持 sim 或 perf');
  process.exit(2);
}
const outputDir = path.join(root, '.test-dist');
const output = path.join(outputDir, `${name}.cjs`);
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(root, 'src', 'sim', `${name}.ts`)],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node18'],
  logLevel: 'warning'
});
const result = spawnSync(process.execPath, [output, ...args], { cwd: root, stdio: 'inherit' });
await rm(outputDir, { recursive: true, force: true });
process.exit(result.status ?? 1);
