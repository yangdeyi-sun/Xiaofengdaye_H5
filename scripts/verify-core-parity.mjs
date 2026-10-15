import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const h5Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harmonyRoot = path.resolve(h5Root, '..', 'xiaofengdaye', 'entry', 'src', 'main', 'ets');
const groups = ['common', 'domain', 'scene'];
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
    if (!source.equals(target)) mismatches.push(`${group}/${sourceName}`);
  }
}

if (mismatches.length > 0) {
  console.error('核心源码与鸿蒙原版不一致：');
  mismatches.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
console.log('核心源码一致：common/domain/scene 仅更换了 .ets → .ts 扩展名。');
