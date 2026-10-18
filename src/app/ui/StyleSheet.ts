import { matchesSelector, type UiElement, type Viewport } from './VirtualDocument';

export type Style = Record<string, string>;
interface Rule { selector: string; values: Style; specificity: number; media: string[]; }

/** Split a CSS value only outside functions/quotes. */
export function splitCss(value: string, delimiter = ','): string[] {
  const result: string[] = []; let depth = 0, quote = '', start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) { if (ch === quote && value[i - 1] !== '\\') quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (depth === 0 && (delimiter === ' ' ? /\s/.test(ch) : ch === delimiter)) {
      if (value.slice(start, i).trim()) result.push(value.slice(start, i).trim()); start = i + 1;
    }
  }
  if (value.slice(start).trim()) result.push(value.slice(start).trim());
  return result;
}

export function declarations(source: string): Style {
  const result: Style = {};
  for (const entry of splitCss(source, ';')) {
    const colon = entry.indexOf(':'); if (colon < 0) continue;
    const key = entry.slice(0, colon).trim(), value = entry.slice(colon + 1).replace(/\s*!important$/, '').trim();
    result[key] = value;
    if (['margin', 'padding', 'inset', 'border-width', 'border-color', 'border-radius'].includes(key)) {
      const parts = splitCss(value, ' '), names = key === 'inset' ? ['top', 'right', 'bottom', 'left'] : ['top', 'right', 'bottom', 'left'].map((edge) =>
        key === 'border-width' ? `border-${edge}-width` : key === 'border-color' ? `border-${edge}-color` : `${key}-${edge}`);
      [parts[0], parts[1] ?? parts[0], parts[2] ?? parts[0], parts[3] ?? parts[1] ?? parts[0]].forEach((part, i) => { result[names[i]] = part; });
    }
    if (key === 'padding-inline') { result['padding-left'] = value; result['padding-right'] = value; }
    if (key === 'border' || /^border-(top|right|bottom|left)$/.test(key)) {
      const parts = splitCss(value, ' '), width = parts.find((part) => /^(\d|\.)/.test(part)) ?? '0';
      const color = parts.find((part) => /^(#|rgb|hsl|white|black|transparent|var)/.test(part)) ?? '#d8bc85';
      for (const edge of key === 'border' ? ['top', 'right', 'bottom', 'left'] : [key.slice(7)]) {
        result[`border-${edge}-width`] = width; result[`border-${edge}-color`] = color;
      }
    }
    if (key === 'gap') { const parts = splitCss(value, ' '); result['row-gap'] = parts[0]; result['column-gap'] = parts[1] ?? parts[0]; }
    if (key === 'place-items') { result['align-items'] = value; result['justify-items'] = value; }
    if (key === 'flex') {
      if (value === 'none') { result['flex-grow'] = '0'; result['flex-shrink'] = '0'; }
      else { const parts = splitCss(value, ' '); result['flex-grow'] = parts[0]; result['flex-shrink'] = parts[1] ?? '1'; result['flex-basis'] = parts[2] ?? '0%'; }
    }
  }
  return result;
}

const INHERITED = ['color', 'font-size', 'font-family', 'font-weight', 'font-style', 'line-height', 'text-align', 'white-space', 'pointer-events', 'text-decoration'];
const INLINE_TAGS = new Set(['SPAN', 'B', 'STRONG', 'SMALL', 'EM', 'I', 'OUTPUT', 'IMG', 'BR', '#TEXT']);

export class StyleSheet {
  private rules: Rule[] = [];
  private readonly cache = new Map<string, Style>();
  constructor(source: string) { this.parse(source.replace(/\/\*[\s\S]*?\*\//g, ''), []); }

  private parse(source: string, media: string[]): void {
    let start = 0;
    while (start < source.length) {
      const open = source.indexOf('{', start); if (open < 0) break;
      let depth = 1, close = open + 1;
      for (; close < source.length && depth > 0; close++) {
        if (source[close] === '{') depth++; if (source[close] === '}') depth--;
      }
      const selector = source.slice(start, open).trim(), body = source.slice(open + 1, close - 1); start = close;
      if (selector.startsWith('@media')) { this.parse(body, [...media, selector.slice(6).trim()]); continue; }
      if (selector.startsWith('@')) continue;
      const values = declarations(body);
      for (const part of splitCss(selector)) {
        const specificity = (part.match(/#[\w-]+/g)?.length ?? 0) * 100 +
          (part.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)?.length ?? 0) * 10 +
          (part.match(/(?:^|[\s>])\w+/g)?.length ?? 0);
        this.rules.push({ selector: part, values, specificity, media });
      }
    }
    this.rules.sort((a, b) => a.specificity - b.specificity);
  }

  resolve(node: UiElement, parent: Style, viewport: Viewport): Style {
    const lineage: string[] = []; let ancestor: UiElement | null = node;
    while (ancestor) {
      const siblings = ancestor.parentElement?.children.filter((child) => child.tagName !== '#TEXT') ?? [];
      lineage.push(`${ancestor.tagName}#${ancestor.id}.${ancestor.getAttribute('class') ?? ''}:${siblings.indexOf(ancestor)}/${siblings.length}`);
      ancestor = ancestor.parentElement;
    }
    const key = `${viewport.width},${viewport.height},${viewport.top},${viewport.bottom}|${lineage.join('/')}|${node.getAttribute('style') ?? ''}|${node.hidden}|${node.hasAttribute('disabled')}|${node.children.length === 0}|` +
      [...INHERITED.map((name) => parent[name] ?? ''), ...Object.entries(parent).filter(([name]) => name.startsWith('--')).map(([name, value]) => `${name}:${value}`)].join('|');
    const cached = this.cache.get(key); if (cached) return { ...cached };
    const tag = node.tagName;
    const result: Style = { display: INLINE_TAGS.has(tag) ? 'inline' : 'block', 'font-size': '16px',
      'font-family': '"Noto Sans SC", "Microsoft YaHei", sans-serif', color: '#3b2a14', 'line-height': 'normal',
      'flex-shrink': '1', 'text-align': 'left' };
    for (const name of INHERITED) if (parent[name]) result[name] = parent[name];
    for (const [name, value] of Object.entries(parent)) if (name.startsWith('--')) result[name] = value;
    if (tag === 'B' || tag === 'STRONG') result['font-weight'] = '700';
    if (tag === 'EM' || tag === 'I') result['font-style'] = 'italic';
    if (tag === 'SMALL') result['font-size'] = `${parseFloat(parent['font-size'] || '16') * 0.833333}px`;
    if (tag === 'BUTTON') Object.assign(result, { display: 'inline-block', padding: '2px 6px', 'padding-top': '2px', 'padding-bottom': '2px',
      'padding-left': '6px', 'padding-right': '6px', 'text-align': 'center', 'border-top-width': '2px', 'border-bottom-width': '2px',
      'border-left-width': '2px', 'border-right-width': '2px', background: '#efefef' });
    if (tag === 'INPUT') Object.assign(result, { display: 'inline-block', height: '20px', 'min-width': '0' });
    if (tag === 'P') Object.assign(result, { 'margin-bottom': '16px' });
    if (tag === 'H1') Object.assign(result, { 'font-size': '32px', 'font-weight': '700', 'margin-bottom': '.67em' });
    if (tag === 'H2') Object.assign(result, { 'font-size': '24px', 'font-weight': '700', 'margin-bottom': '.83em' });
    if (tag === 'H3') Object.assign(result, { 'font-size': '18.72px', 'font-weight': '700', 'margin-bottom': '1em' });
    if (tag === 'UL' || tag === 'OL') Object.assign(result, { 'padding-left': '40px', 'margin-top': '16px', 'margin-bottom': '16px' });
    for (const rule of this.rules) {
      if (rule.selector.includes('::') || !rule.media.every((condition) => mediaMatches(condition, viewport))) continue;
      if (matchesSelector(node, rule.selector)) Object.assign(result, rule.values);
    }
    Object.assign(result, declarations(node.getAttribute('style') ?? ''));
    for (const name of Object.keys(result)) {
      result[name] = expandVars(result[name], result);
      if (result[name] === 'inherit' || result[name] === 'unset') result[name] = parent[name] ?? '';
    }
    if (node.hidden) result.display = 'none';
    if (this.cache.size > 4096) this.cache.clear();
    this.cache.set(key, result);
    return result;
  }
}

function expandVars(value: string, style: Style): string {
  for (let i = 0; i < 8 && value.includes('var('); i++) value = value.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_m, key: string, fallback: string) => style[key] ?? fallback ?? '');
  return value;
}
function mediaMatches(condition: string, viewport: Viewport): boolean {
  if (/prefers-reduced-motion/.test(condition)) return false;
  let matches = true;
  for (const m of condition.matchAll(/\((min|max)-(width|height):\s*([\d.]+)px\)/g)) {
    const actual = m[2] === 'width' ? viewport.width : viewport.height;
    if (m[1] === 'min' ? actual < Number(m[3]) : actual > Number(m[3])) matches = false;
  }
  if (condition.includes('orientation: landscape') && viewport.height > viewport.width) matches = false;
  return matches;
}

/** Numeric CSS subset used by the shared stylesheet: no eval or generated JavaScript. */
export function cssLength(value: string | undefined, reference: number, viewport: Viewport, font = 16): number | undefined {
  if (!value || value === 'auto' || value === 'none' || value === 'normal') return undefined;
  value = value.trim();
  const atom = value.match(/^(-?[\d.]+)(px|rem|em|vw|vh|%)?$/);
  if (atom) {
    const n = Number(atom[1]);
    return n * ({ px: 1, rem: 16, em: font, vw: viewport.width / 100, vh: viewport.height / 100, '%': reference / 100 }[atom[2]] ?? 1);
  }
  if (value.startsWith('env(')) return value.includes('top') ? viewport.top : value.includes('bottom') ? viewport.bottom : 0;
  const fn = value.match(/^(min|max|clamp|calc)\(([\s\S]*)\)$/);
  if (fn) {
    if (fn[1] === 'calc') {
      const parts = splitCss(fn[2].replace(/\s([+-])\s/g, ',$1,'));
      let sum = cssLength(parts[0], reference, viewport, font) ?? 0;
      for (let i = 1; i < parts.length; i += 2) sum += (parts[i] === '-' ? -1 : 1) * (cssLength(parts[i + 1], reference, viewport, font) ?? 0);
      return sum;
    }
    const values = splitCss(fn[2]).map((part) => cssLength(part, reference, viewport, font) ?? 0);
    return fn[1] === 'min' ? Math.min(...values) : fn[1] === 'max' ? Math.max(...values) : Math.max(values[0], Math.min(values[1], values[2]));
  }
  return undefined;
}

export function canvasColor(value: string): string {
  return value.replace(/rgb\(([\d.]+) ([\d.]+) ([\d.]+)(?:\s*\/\s*([\d.]+)(%)?)?\)/g, (_m, r, g, b, a, percent) =>
    a === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${Number(a) / (percent ? 100 : 1)})`);
}
