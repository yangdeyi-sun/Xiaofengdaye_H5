import { Resvg } from '@resvg/resvg-js';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Same vector artwork as H5, rasterized at 3x for hosts without SVG image decoding. */
export async function convertIcons(source, output) {
  await mkdir(output, { recursive: true });
  for (const file of await readdir(source)) {
    if (!file.endsWith('.svg')) continue;
    const svg = await readFile(path.join(source, file), 'utf8');
    const renderer = new Resvg(svg, { fitTo: { mode: 'width', value: 192 }, font: { loadSystemFonts: false } });
    await writeFile(path.join(output, file.replace(/\.svg$/, '.png')), renderer.render().asPng());
  }
}
