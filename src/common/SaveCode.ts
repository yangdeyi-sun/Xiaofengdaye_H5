/**
 * 存档码：把存档文本压缩成一串可以复制粘贴的字符（换手机、清缓存前导出，之后导入恢复）。
 * 格式：`XFDY1-` + base64url( LZW(UTF-8 字节) )。不依赖 TextEncoder / btoa，小游戏环境同样可用。
 */

const PREFIX = 'XFDY1-';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function fromUtf8(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    let c: number;
    if (b < 0x80) c = b;
    else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63);
    else if (b < 0xf0) c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else c = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    if (c >= 0x10000) { c -= 0x10000; out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); }
    else out += String.fromCharCode(c);
  }
  return out;
}

const MAX_BITS = 16;
const CLEAR = 256;
const FIRST = 257;

/** LZW（9~16 位可变码长，字典满时清空） */
function lzw(bytes: number[]): number[] {
  const out: number[] = [];
  let bits = 9;
  let acc = 0;
  let accBits = 0;
  const write = (code: number): void => {
    acc |= code << accBits;
    accBits += bits;
    while (accBits >= 8) { out.push(acc & 255); acc >>>= 8; accBits -= 8; }
  };
  let dict = new Map<string, number>();
  let next = FIRST;
  let w = '';
  for (let i = 0; i < bytes.length; i++) {
    const k = String.fromCharCode(bytes[i]);
    const wk = w + k;
    if (w.length === 0 || dict.has(wk)) { w = wk; continue; }
    write(w.length === 1 ? w.charCodeAt(0) : dict.get(w)!);
    dict.set(wk, next++);
    if (next > (1 << bits) && bits < MAX_BITS) bits++;
    if (next >= (1 << MAX_BITS)) { write(CLEAR); dict = new Map(); next = FIRST; bits = 9; }
    w = k;
  }
  if (w.length > 0) write(w.length === 1 ? w.charCodeAt(0) : dict.get(w)!);
  if (accBits > 0) out.push(acc & 255);
  return out;
}

function unlzw(data: number[]): number[] {
  const out: number[] = [];
  let bits = 9;
  let acc = 0;
  let accBits = 0;
  let pos = 0;
  const read = (): number => {
    while (accBits < bits) {
      if (pos >= data.length) return -1;
      acc |= data[pos++] << accBits;
      accBits += 8;
    }
    const code = acc & ((1 << bits) - 1);
    acc >>>= bits;
    accBits -= bits;
    return code;
  };
  let dict: number[][] = [];
  let next = FIRST;
  let prev: number[] | null = null;
  for (;;) {
    // 与压缩端同步：压缩端在写出“下一码”之前已经扩宽了码长
    const code = read();
    if (code < 0) break;
    if (code === CLEAR) { dict = []; next = FIRST; bits = 9; prev = null; continue; }
    let entry: number[];
    if (code < 256) entry = [code];
    else if (dict[code] !== undefined) entry = dict[code];
    else if (code === next && prev !== null) entry = prev.concat(prev[0]);
    else throw new Error('存档码已损坏');
    for (let i = 0; i < entry.length; i++) out.push(entry[i]);
    if (prev !== null) {
      dict[next++] = prev.concat(entry[0]);
      if (next + 1 > (1 << bits) && bits < MAX_BITS) bits++;
      if (next >= (1 << MAX_BITS)) { /* 压缩端会紧接着写 CLEAR */ }
    }
    prev = entry;
  }
  return out;
}

function toB64(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) s += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) s += B64[n & 63];
  }
  return s;
}

function fromB64(text: string): number[] {
  const out: number[] = [];
  const clean = text.replace(/[^A-Za-z0-9\-_]/g, '');
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : -1));
    if (v[0] < 0 || v[1] < 0) break;
    const n = (v[0] << 18) | (v[1] << 12) | ((v[2] < 0 ? 0 : v[2]) << 6) | (v[3] < 0 ? 0 : v[3]);
    out.push((n >> 16) & 255);
    if (v[2] >= 0) out.push((n >> 8) & 255);
    if (v[3] >= 0) out.push(n & 255);
  }
  return out;
}

export function encodeSaveCode(saveText: string): string {
  return PREFIX + toB64(lzw(utf8(saveText)));
}

/** 解出存档文本；格式不对返回 null（存档本身的校验由 decodeEnvelope 负责） */
export function decodeSaveCode(code: string): string | null {
  const trimmed = code.trim();
  const at = trimmed.indexOf(PREFIX);
  if (at < 0) return null;
  try {
    return fromUtf8(unlzw(fromB64(trimmed.substring(at + PREFIX.length))));
  } catch {
    return null;
  }
}
