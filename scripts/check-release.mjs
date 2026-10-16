import { checkRelease } from './release-config.mjs';

let failed = false;
for (const target of ['douyin', 'android']) {
  try { checkRelease(target); console.log(`${target}: 发布资料校验通过`); }
  catch (error) { failed = true; console.error(`${target}:\n${error.message}`); }
}
console.log('发布签名通过 XF_KEYSTORE_PATH / XF_KEYSTORE_PASSWORD / XF_KEY_ALIAS / XF_KEY_PASSWORD 环境变量提供，不写进仓库。');
process.exitCode = failed ? 1 : 0;
