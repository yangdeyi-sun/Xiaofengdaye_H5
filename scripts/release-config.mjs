import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const config = JSON.parse(await readFile(path.join(root, 'release.config.json'), 'utf8'));
export const legalDefines = {
  __PUBLISHER__: JSON.stringify(config.publisher),
  __SUPPORT_EMAIL__: JSON.stringify(config.supportEmail)
};
export function checkRelease(target) {
  const errors = [];
  if (!config.publisher?.trim()) errors.push('release.config.json: publisher（真实发布主体）未填写');
  if (!config.supportEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.supportEmail) || /example\./i.test(config.supportEmail)) errors.push('release.config.json: supportEmail（真实联系邮箱）未填写');
  if (target === 'douyin' && !/^tt[\da-z]+$/i.test(config.douyinAppId)) errors.push('release.config.json: douyinAppId 未填写有效的抖音 AppID');
  if (!/^[a-z][\w]*(\.[a-z][\w]*){2,}$/.test(config.applicationId)) errors.push('applicationId 格式无效');
  if (!Number.isInteger(config.versionCode) || config.versionCode < 1) errors.push('versionCode 必须是正整数');
  if (errors.length) throw new Error(errors.join('\n'));
}
