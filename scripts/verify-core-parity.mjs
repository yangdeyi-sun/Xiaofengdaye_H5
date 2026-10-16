import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const h5Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harmonyRoot = path.resolve(h5Root, '..', 'xiaofengdaye', 'entry', 'src', 'main', 'ets');
const groups = ['common', 'domain', 'scene'];
/**
 * 0.3 起为修复新手节奏和蜂巢显示问题，以下核心文件有意与鸿蒙原版不同（改动说明见 docs/CHANGELOG_0.3.md）。
 * 其余核心文件仍要求逐字节一致。
 */
const INTENTIONAL = new Set([
  'domain/GameConfig.ets', 'domain/ColonyService.ets', 'domain/Guide.ets', 'scene/SceneRenderer.ets'
]);
const mismatches = [];

for (const group of groups) {
  const sourceDir = path.join(harmonyRoot, group);
  const targetDir = path.join(h5Root, 'src', group);
  const sourceFiles = (await readdir(sourceDir)).filter((name) => name.endsWith('.ets')).sort();
  const targetFiles = (await readdir(targetDir)).filter((name) => name.endsWith('.ts')).sort();
  const expectedTargets = sourceFiles.map((name) => name.replace(/\.ets$/, '.ts'));
  if (JSON.stringify(targetFiles) !== JSON.stringify(expectedTargets)) {
    mismatches.push(`${group}: 文件集合不同`);
    continue;
  }
  for (const sourceName of sourceFiles) {
    const targetName = sourceName.replace(/\.ets$/, '.ts');
    const source = await readFile(path.join(sourceDir, sourceName));
    const target = await readFile(path.join(targetDir, targetName));
    if (INTENTIONAL.has(`${group}/${sourceName}`)) continue;
    if (!source.equals(target)) mismatches.push(`${group}/${sourceName}`);
  }
}

if (mismatches.length > 0) {
  console.error('核心源码与鸿蒙原版不一致：');
  mismatches.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
console.log(`核心源码一致：common/domain/scene 仅更换了 .ets → .ts 扩展名（${INTENTIONAL.size} 个有意修改的文件除外）。`);
