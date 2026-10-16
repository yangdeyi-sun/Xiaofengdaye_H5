import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, checkRelease } from './release-config.mjs';

if (process.argv.includes('--release')) checkRelease('android');
const built = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--minify'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status || 1);
const target = path.join(root, 'android/app/src/main/assets');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(path.join(root, 'dist'), target, { recursive: true, filter: (file) => !/canvas-preview(\.html|\.js)$/.test(file) });
console.log(`Android 离线资源已同步到 ${target}`);
