// 把配饰 SVG 渲染成透明 PNG（使用项目 devDependencies 里的 @resvg/resvg-js）
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js');
const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const it of items) {
  const r = new Resvg(it.svg, { fitTo: { mode: 'width', value: it.size ?? 512 }, background: 'rgba(0,0,0,0)' });
  fs.writeFileSync(it.out, r.render().asPng());
}
console.log('rendered', items.length);
