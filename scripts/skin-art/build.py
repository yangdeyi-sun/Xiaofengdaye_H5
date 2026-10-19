"""生成十款蜂巢皮肤的建筑图集与皮肤背景（与琥珀/薄荷夜等现有皮肤同一画风）。

每款皮肤 = 自己的六边形边框（含独特装饰）+ 自己的底板花纹 + 原有建筑图标（从琥珀图集抠出，不改画风）。
输出：
- public/art/v1/atlas_skin_<id>.webp/.json（1820x520，帧位置与 atlas_skin_amber 完全相同）
- public/art/v1/low/atlas_skin_<id>.webp/.json（半尺寸）
- public/art/v1/skin_background_<id>.webp（512x512，蜂巢页背景与皮肤选择缩略图）

用法（项目根目录）：python scripts/skin-art/build.py [皮肤id ...]
依赖：Python 3 + Pillow + numpy；Node（npm install 后的 @resvg/resvg-js）
"""
import json, math, os, subprocess, sys, tempfile, copy, random
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ART = os.path.join(ROOT, 'public', 'art', 'v1')
RENDER = os.path.join(ROOT, 'scripts', 'star-art', 'render.mjs')
TMP = tempfile.mkdtemp(prefix='skin-art-')

# 帧位置（与 atlas_skin_amber.json 一致）
FRAMES = ['queen', 'nursery', 'scout', 'forager', 'brewery', 'storage', 'guard', 'evolution']
POS = [(2 + 260 * i, 2) for i in range(7)] + [(2, 262)]

# 琥珀图集里的几何：外框正六边形、内底板（下边更厚，带立体感）
OUTER = [(128, 17.8), (223, 72.6), (223, 182.4), (128, 237.2), (33, 182.4), (33, 72.6)]
INNER = [(128, 36), (202, 78.5), (202, 164.5), (128, 207), (54, 164.5), (54, 78.5)]
AMBER_PANEL = np.array([244, 215, 144], dtype=np.float32)
AMBER_LINE = np.array([96, 72, 47], dtype=np.float32)
AMBER_GROUND = np.array([199, 133, 59], dtype=np.float32)


def pts(poly):
    return ' '.join(f'{x:.1f},{y:.1f}' for x, y in poly)


def lerp_poly(a, b, t):
    return [(ax + (bx - ax) * t, ay + (by - ay) * t) for (ax, ay), (bx, by) in zip(a, b)]


def mid(p, q, t=0.5):
    return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)


# ---------- 小图形 ----------
def star5(x, y, r, fill, stroke='none', sw=0, rot=-90):
    p = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * 0.45
        a = math.radians(rot + i * 36)
        p.append((x + rr * math.cos(a), y + rr * math.sin(a)))
    return f'<polygon points="{pts(p)}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>'


def sparkle(x, y, r, fill, glow=None):
    d = (f'M{x},{y - r} Q{x + r * 0.16},{y - r * 0.16} {x + r},{y} Q{x + r * 0.16},{y + r * 0.16} {x},{y + r} '
         f'Q{x - r * 0.16},{y + r * 0.16} {x - r},{y} Q{x - r * 0.16},{y - r * 0.16} {x},{y - r}Z')
    g = f'<circle cx="{x}" cy="{y}" r="{r * 0.9}" fill="{glow}" opacity="0.45" filter="url(#soft)"/>' if glow else ''
    return f'{g}<path d="{d}" fill="{fill}"/>'


def leaf3(x, y, s, fill, line, rot=0):
    """三叶草：三片心形叶"""
    out = [f'<g transform="translate({x},{y}) rotate({rot}) scale({s})">']
    for a in (-90, 30, 150):
        out.append(f'<g transform="rotate({a + 90})"><path d="M0,0 C-7,-4 -10,-12 -5,-15 C-2,-17 0,-14 0,-12 C0,-14 2,-17 5,-15 C10,-12 7,-4 0,0Z" '
                   f'fill="{fill}" stroke="{line}" stroke-width="1.6" stroke-linejoin="round"/>'
                   f'<path d="M0,-2 L0,-11" stroke="{line}" stroke-width="0.9" opacity="0.6"/></g>')
    out.append(f'<path d="M0,0 Q3,7 1,12" fill="none" stroke="{line}" stroke-width="1.8" stroke-linecap="round"/></g>')
    return ''.join(out)


def snowflake(x, y, r, color, w=1.2):
    out = [f'<g transform="translate({x},{y})" stroke="{color}" stroke-width="{w}" stroke-linecap="round" fill="none">']
    for i in range(6):
        a = i * 60
        out.append(f'<g transform="rotate({a})"><path d="M0,0 L0,{-r}"/><path d="M0,{-r * 0.6} L{r * 0.28},{-r * 0.85}"/>'
                   f'<path d="M0,{-r * 0.6} L{-r * 0.28},{-r * 0.85}"/></g>')
    out.append('</g>')
    return ''.join(out)


def lily_pad(x, y, r, fill, line, rot=0):
    a0 = math.radians(rot - 18)
    a1 = math.radians(rot + 18)
    p0 = (x + r * math.cos(a0), y + r * math.sin(a0))
    p1 = (x + r * math.cos(a1), y + r * math.sin(a1))
    return (f'<path d="M{x},{y} L{p0[0]:.1f},{p0[1]:.1f} A{r},{r} 0 1 0 {p1[0]:.1f},{p1[1]:.1f} Z" fill="{fill}" stroke="{line}" stroke-width="2" stroke-linejoin="round"/>'
            f'<path d="M{x},{y} L{x - r * 0.6 * math.cos(math.radians(rot)):.1f},{y - r * 0.6 * math.sin(math.radians(rot)):.1f}" stroke="{line}" stroke-width="1" opacity="0.5"/>')


def lotus(x, y, s, petal, line, center):
    out = [f'<g transform="translate({x},{y}) scale({s})">']
    for a, c in ((-60, petal), (60, petal), (-30, petal), (30, petal), (0, petal)):
        out.append(f'<path transform="rotate({a})" d="M0,2 C-6,-4 -5,-14 0,-19 C5,-14 6,-4 0,2Z" fill="{c}" stroke="{line}" stroke-width="1.5" stroke-linejoin="round"/>')
    out.append(f'<ellipse cx="0" cy="1" rx="5" ry="2.6" fill="{center}" stroke="{line}" stroke-width="1.2"/></g>')
    return ''.join(out)


def cactus(x, y, s, fill, line):
    return (f'<g transform="translate({x},{y}) scale({s})" fill="{fill}" stroke="{line}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">'
            '<path d="M-4,10 L-4,-14 Q-4,-19 0,-19 Q4,-19 4,-14 L4,10 Z"/>'
            '<path d="M-4,-2 L-9,-2 Q-12,-2 -12,-6 L-12,-10 Q-12,-12 -10,-12 Q-8,-12 -8,-10 L-8,-6 L-4,-6"/>'
            '<path d="M4,2 L9,2 Q12,2 12,-2 L12,-7 Q12,-9 10,-9 Q8,-9 8,-7 L8,-2 L4,-2"/>'
            '<path d="M0,-15 L0,8" fill="none" stroke-width="0.9" opacity="0.5"/></g>')


def pennant(x, y, s, cloth, line, pole, flip=False):
    sx = -s if flip else s
    return (f'<g transform="translate({x},{y}) scale({sx},{s})">'
            f'<path d="M0,-4 L0,40" stroke="{pole}" stroke-width="3" stroke-linecap="round"/>'
            f'<circle cx="0" cy="-5" r="3" fill="{pole}" stroke="{line}" stroke-width="1.2"/>'
            f'<path d="M1,0 L22,4 L22,30 L12,24 L1,32 Z" fill="{cloth}" stroke="{line}" stroke-width="1.8" stroke-linejoin="round"/>'
            f'<path d="M5,9 L18,11" stroke="#F6D36B" stroke-width="2" stroke-linecap="round"/>'
            f'<path d="M5,15 L18,17" stroke="#F6D36B" stroke-width="2" stroke-linecap="round"/></g>')


def shield(x, y, s, fill, line, accent):
    return (f'<g transform="translate({x},{y}) scale({s})">'
            f'<path d="M-12,-12 L12,-12 L12,0 Q12,10 0,16 Q-12,10 -12,0 Z" fill="{fill}" stroke="{line}" stroke-width="2" stroke-linejoin="round"/>'
            f'<path d="M-8,4 L0,-4 L8,4" fill="none" stroke="{accent}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
            f'<path d="M-8,-8 L8,-8" stroke="{accent}" stroke-width="1.5" opacity="0.7"/></g>')


def crown(x, y, s, fill, line, gem='#E2475B'):
    return (f'<g transform="translate({x},{y}) scale({s})">'
            f'<path d="M-15,8 L-17,-8 L-8,0 L0,-12 L8,0 L17,-8 L15,8 Z" fill="{fill}" stroke="{line}" stroke-width="2" stroke-linejoin="round"/>'
            f'<rect x="-15" y="7" width="30" height="5" rx="1.5" fill="{fill}" stroke="{line}" stroke-width="2"/>'
            f'<circle cx="0" cy="-12" r="2.6" fill="{gem}" stroke="{line}" stroke-width="1.2"/>'
            f'<circle cx="-17" cy="-8" r="2" fill="#FFF3C8" stroke="{line}" stroke-width="1"/>'
            f'<circle cx="17" cy="-8" r="2" fill="#FFF3C8" stroke="{line}" stroke-width="1"/>'
            f'<circle cx="0" cy="3" r="2.6" fill="{gem}" stroke="{line}" stroke-width="1.1"/></g>')


def gem(x, y, r, fill, line):
    p = [(x, y - r), (x + r * 0.8, y), (x, y + r), (x - r * 0.8, y)]
    return (f'<polygon points="{pts(p)}" fill="{fill}" stroke="{line}" stroke-width="1.6" stroke-linejoin="round"/>'
            f'<path d="M{x - r * 0.3},{y - r * 0.35} L{x},{y - r * 0.7}" stroke="#FFFFFF" stroke-width="1.4" opacity="0.8" stroke-linecap="round"/>')


def moon(x, y, r, fill, line, bg):
    return (f'<g><circle cx="{x}" cy="{y}" r="{r * 1.5}" fill="{fill}" opacity="0.35" filter="url(#soft)"/>'
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{line}" stroke-width="1.8"/>'
            f'<circle cx="{x + r * 0.45}" cy="{y - r * 0.3}" r="{r * 0.85}" fill="{bg}" stroke="{line}" stroke-width="1.8"/></g>')


def filigree(x, y, s, color, line, rot=0):
    return (f'<g transform="translate({x},{y}) rotate({rot}) scale({s})" fill="none" stroke-linecap="round">'
            f'<path d="M0,0 C6,-2 10,-8 7,-12 C5,-14 2,-12 3,-10" stroke="{line}" stroke-width="3.6"/>'
            f'<path d="M0,0 C-6,-2 -10,-8 -7,-12 C-5,-14 -2,-12 -3,-10" stroke="{line}" stroke-width="3.6"/>'
            f'<path d="M0,0 C6,-2 10,-8 7,-12 C5,-14 2,-12 3,-10" stroke="{color}" stroke-width="1.8"/>'
            f'<path d="M0,0 C-6,-2 -10,-8 -7,-12 C-5,-14 -2,-12 -3,-10" stroke="{color}" stroke-width="1.8"/>'
            f'<circle cx="0" cy="1" r="2.6" fill="{color}" stroke="{line}" stroke-width="1.2"/></g>')


def neon_tube(poly, color, width):
    return (f'<polygon points="{pts(poly)}" fill="none" stroke="{color}" stroke-width="{width * 3.2}" opacity="0.55" filter="url(#glow)" stroke-linejoin="round"/>'
            f'<polygon points="{pts(poly)}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"/>'
            f'<polygon points="{pts(poly)}" fill="none" stroke="#FFFFFF" stroke-width="{width * 0.35}" opacity="0.8" stroke-linejoin="round"/>')


# ---------- 皮肤定义 ----------
# line 描边，outer 外框带，inner 内框带，panel 底板，ground 底座，bg 背景底色（与 GameConfig 中 bg 一致）
SKINS = {
    'clover': dict(line='#2E4A2A', outer='#4E8B45', inner='#A5D27F', panel='#EEF7DD', ground='#97C977', bg='#16301C'),
    'snowline': dict(line='#3D5672', outer='#7EA6CB', inner='#DCEBF8', panel='#F5FAFE', ground='#C3D9EC', bg='#1C2836'),
    'lily': dict(line='#244B47', outer='#3A8A82', inner='#93D3C8', panel='#DDF2EE', ground='#A5DCD1', bg='#1E2C2A'),
    'dune': dict(line='#6A4320', outer='#B8773A', inner='#E9C47F', panel='#FBEDCB', ground='#E5BB72', bg='#33230F'),
    'neon': dict(line='#0E0A1E', outer='#1E173A', inner='#2C2452', panel='#BFB6EC', ground='#9C90D8', bg='#1A1530'),
    'emperor': dict(line='#3A1858', outer='#6A2FA0', inner='#E8BA42', panel='#F5EAFB', ground='#D3B9E8', bg='#1F0F2E'),
    'warbanner': dict(line='#35180F', outer='#5C5A63', inner='#B4392D', panel='#F7E5CB', ground='#DDAA78', bg='#2A1410'),
    'starlight': dict(line='#1E2A55', outer='#2C3E7C', inner='#EAC34C', panel='#FFF8DE', ground='#F1DC97', bg='#121A33'),
    'royal': dict(line='#5A3900', outer='#B8860B', inner='#FFD54F', panel='#FFF5D6', ground='#F2D06E', bg='#2B1C05'),
    'starry': dict(line='#131B45', outer='#22306F', inner='#4B5FBA', panel='#D7DFFA', ground='#A9B7EA', bg='#0E1430'),
}

DEFS = ('<defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>'
        '<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>'
        '<clipPath id="panel"><polygon points="{inner}"/></clipPath></defs>').format(inner=pts(INNER))


def frame_svg(sid, c):
    """边框层：外框带 + 内框带 + 描边 + 每款皮肤自己的装饰（不覆盖底板中央）"""
    o, i = OUTER, INNER
    band = lerp_poly(o, i, 0.42)
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">{DEFS}']
    # 底部投影
    shadow = [(x, y + 8) for x, y in o]
    s.append(f'<polygon points="{pts(shadow)}" fill="#5F3F2A" opacity="0.10"/>')
    ring = f'M{pts(o)}Z M{pts(i)}Z'.replace(' ', ' L').replace('M', 'M').replace('Z L', 'Z ')
    outer_ring = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in o) + 'Z M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in band) + 'Z'
    inner_ring = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in band) + 'Z M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in i) + 'Z'
    del ring
    if sid == 'royal':
        s.append('<defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE68A"/>'
                 '<stop offset="0.5" stop-color="#E7A928"/><stop offset="1" stop-color="#FFD54F"/></linearGradient></defs>')
        s.append(f'<path d="{outer_ring}" fill-rule="evenodd" fill="{c["outer"]}"/>')
        s.append(f'<path d="{inner_ring}" fill-rule="evenodd" fill="url(#gold)"/>')
    else:
        s.append(f'<path d="{outer_ring}" fill-rule="evenodd" fill="{c["outer"]}"/>')
        s.append(f'<path d="{inner_ring}" fill-rule="evenodd" fill="{c["inner"]}"/>')
    s.append(f'<polygon points="{pts(band)}" fill="none" stroke="{c["line"]}" stroke-width="2.2" stroke-linejoin="round"/>')
    s.append(f'<polygon points="{pts(o)}" fill="none" stroke="{c["line"]}" stroke-width="3.4" stroke-linejoin="round"/>')
    s.append(f'<polygon points="{pts(i)}" fill="none" stroke="{c["line"]}" stroke-width="3" stroke-linejoin="round"/>')
    s.append(DECOR[sid](c))
    s.append('</svg>')
    return ''.join(s)


def panel_svg(sid, c):
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">{DEFS}']
    s.append(f'<g clip-path="url(#panel)"><polygon points="{pts(INNER)}" fill="{c["panel"]}"/>{PATTERN[sid](c)}'
             f'<ellipse cx="128" cy="180" rx="58.5" ry="11.3" fill="{c["ground"]}" stroke="#60482F" stroke-width="2.6"/></g></svg>')
    return ''.join(s)


def vtx(k, t=0.0):
    """外框带中线上的第 k 个顶点（0 顶，1 右上，2 右下，3 底，4 左下，5 左上）"""
    band = lerp_poly(OUTER, INNER, 0.42)
    return band[k]


def edge_mid(k, poly=None):
    poly = poly or lerp_poly(OUTER, INNER, 0.42)
    return mid(poly[k], poly[(k + 1) % 6])


# ---------- 各皮肤装饰（边框上） ----------
def d_clover(c):
    out = []
    for k, rot, s in ((0, 0, 1.15), (2, 20, 0.95), (4, -20, 0.95)):
        x, y = vtx(k)
        out.append(leaf3(x, y + (2 if k == 0 else 0), s, '#6DB35A', c['line'], rot))
    for k in (1, 5):
        x, y = vtx(k)
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="#F8F3D8" stroke="{c["line"]}" stroke-width="1.4"/>')
    for k in range(6):
        x, y = edge_mid(k)
        out.append(f'<path d="M{x - 3:.1f},{y:.1f} Q{x:.1f},{y - 5:.1f} {x + 3:.1f},{y:.1f} Q{x:.1f},{y + 5:.1f} {x - 3:.1f},{y:.1f}Z" fill="#E8F4D0" stroke="{c["line"]}" stroke-width="1"/>')
    return ''.join(out)


def d_snowline(c):
    o = OUTER
    # 顶上两条斜边积雪：沿外边铺一层带垂滴的白雪
    top = [o[5], o[0], o[1]]
    pts_top = []
    n = 18
    for seg in range(2):
        a, b = top[seg], top[seg + 1]
        for j in range(n):
            t = j / n
            pts_top.append(mid(a, b, t))
    pts_top.append(top[2])
    upper = [(x, y - 4) for x, y in pts_top]
    lower = []
    for j, (x, y) in enumerate(reversed(pts_top)):
        drip = 9 + 6 * math.sin(j * 1.7) + (7 if j % 5 == 2 else 0)
        lower.append((x, y + drip))
    path = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in upper) + ' L' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in lower) + 'Z'
    out = [f'<path d="{path}" fill="#FFFFFF" stroke="{c["line"]}" stroke-width="2" stroke-linejoin="round"/>']
    # 冰凌：底下两条斜边挂冰柱
    for k in (2, 3):
        a, b = o[k], o[(k + 1) % 6]
        for j in range(1, 5):
            x, y = mid(a, b, j / 5)
            h = 7 + (j % 2) * 5
            out.append(f'<path d="M{x - 3:.1f},{y - 1:.1f} L{x + 3:.1f},{y - 1:.1f} L{x:.1f},{y + h:.1f}Z" fill="#E6F3FF" stroke="{c["line"]}" stroke-width="1.2" stroke-linejoin="round"/>')
    for k in (2, 4):
        x, y = vtx(k)
        out.append(snowflake(x, y, 7, '#FFFFFF', 2.2))
    return ''.join(out)


def d_lily(c):
    out = []
    for k, rot in ((1, 200), (5, -20), (2, 160), (4, 20)):
        x, y = edge_mid(k) if k in (1, 4) else vtx(k)
        out.append(lily_pad(x, y, 11 if k in (1, 4) else 9, '#5BAA62', c['line'], rot))
    x, y = vtx(3)
    out.append(lotus(x, y - 2, 1.05, '#F6A9C2', c['line'], '#F7D35A'))
    x, y = vtx(0)
    out.append(lotus(x, y + 1, 0.7, '#FBD0DF', c['line'], '#F7D35A'))
    # 水波
    for k in (2, 4):
        a, b = OUTER[k], OUTER[(k + 1) % 6]
        x, y = mid(a, b, 0.5)
        out.append(f'<path d="M{x - 9:.1f},{y + 6:.1f} q4.5,-4 9,0 t9,0" fill="none" stroke="#D8F3FF" stroke-width="2" stroke-linecap="round"/>')
    return ''.join(out)


def d_dune(c):
    out = []
    # 太阳在左上角，仙人掌在右下
    x, y = vtx(5)
    out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="13" fill="#FFD25A" opacity="0.4" filter="url(#soft)"/>')
    for a in range(0, 360, 45):
        r0, r1 = 9, 14
        out.append(f'<path d="M{x + r0 * math.cos(math.radians(a)):.1f},{y + r0 * math.sin(math.radians(a)):.1f} L{x + r1 * math.cos(math.radians(a)):.1f},{y + r1 * math.sin(math.radians(a)):.1f}" stroke="#F29C1F" stroke-width="2.4" stroke-linecap="round"/>')
    out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="#FFC93C" stroke="{c["line"]}" stroke-width="1.6"/>')
    x, y = vtx(2)
    out.append(cactus(x + 2, y - 4, 1.05, '#6FAE58', c['line']))
    # 沙丘曲线铺在外框带上
    for k in (3, 4):
        a, b = OUTER[k], OUTER[(k + 1) % 6]
        for j in (0.3, 0.65):
            x, y = mid(a, b, j)
            out.append(f'<path d="M{x - 10:.1f},{y - 6:.1f} q5,-4 10,0 t10,0" fill="none" stroke="#F3D79A" stroke-width="2" stroke-linecap="round"/>')
    x, y = vtx(0)
    out.append(f'<path d="M{x - 9:.1f},{y + 4:.1f} Q{x:.1f},{y - 10:.1f} {x + 9:.1f},{y + 4:.1f}Z" fill="#E9B866" stroke="{c["line"]}" stroke-width="1.6" stroke-linejoin="round"/>')
    return ''.join(out)


def d_neon(c):
    o = lerp_poly(OUTER, INNER, 0.2)
    i = lerp_poly(OUTER, INNER, 0.72)
    out = [neon_tube(o, '#3FF2FF', 2.2), neon_tube(i, '#FF4FD8', 1.8)]
    for k in range(6):
        x, y = OUTER[k]
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="#FFE45C" opacity="0.6" filter="url(#glow)"/>'
                   f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.6" fill="#FFF6B0"/>')
    # 楼顶天线 + 小招牌
    x, y = OUTER[0]
    out.append(f'<path d="M{x:.1f},{y:.1f} L{x:.1f},{y - 10:.1f}" stroke="#8C84B8" stroke-width="2"/>'
               f'<circle cx="{x:.1f}" cy="{y - 11:.1f}" r="2.4" fill="#FF4F6A"/>')
    return ''.join(out)


def d_emperor(c):
    out = []
    x, y = vtx(0)
    out.append(crown(x, y - 4, 1.0, '#F2C443', c['line']))
    # 五域徽记：五个种区颜色的宝石
    colors = ['#5BBF6A', '#5FA8E8', '#F08AB4', '#E9B45A', '#B07BE8']
    for k, col in zip((1, 2, 3, 4, 5), colors):
        x, y = vtx(k)
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8.5" fill="#F5D46A" stroke="{c["line"]}" stroke-width="1.6"/>')
        out.append(gem(x, y, 6.2, col, c['line']))
    for k in range(6):
        x, y = edge_mid(k, lerp_poly(OUTER, INNER, 0.75))
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.8" fill="#FFF3C8"/>')
    return ''.join(out)


def d_warbanner(c):
    out = []
    # 铆钉
    band = lerp_poly(OUTER, INNER, 0.2)
    for k in range(6):
        for t in (0.25, 0.75):
            x, y = mid(band[k], band[(k + 1) % 6], t)
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.2" fill="#C9C9D2" stroke="{c["line"]}" stroke-width="1"/>')
    x, y = OUTER[5]
    out.append(pennant(x + 1, y - 2, 0.95, '#D2352B', c['line'], '#E7B73F'))
    x, y = OUTER[1]
    out.append(pennant(x - 1, y - 2, 0.95, '#D2352B', c['line'], '#E7B73F', flip=True))
    x, y = vtx(3)
    out.append(shield(x, y - 3, 1.0, '#C23A2E', c['line'], '#F3C449'))
    x, y = vtx(0)
    out.append(f'<path d="M{x - 7:.1f},{y + 3:.1f} L{x:.1f},{y - 6:.1f} L{x + 7:.1f},{y + 3:.1f}" fill="none" stroke="#F3C449" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>')
    return ''.join(out)


def d_starlight(c):
    out = []
    x, y = vtx(0)
    out.append(sparkle(x, y, 13, '#FFF2A8', '#FFE070'))
    for k, r in ((1, 8), (2, 6), (3, 9), (4, 6), (5, 8)):
        x, y = vtx(k)
        out.append(sparkle(x, y, r, '#FFF6C4', '#FFD84A'))
    band = lerp_poly(OUTER, INNER, 0.2)
    rnd = random.Random(7)
    for k in range(6):
        for t in (0.3, 0.7):
            x, y = mid(band[k], band[(k + 1) % 6], t)
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{1.3 + rnd.random():.1f}" fill="#FFFFFF" opacity="0.9"/>')
    return ''.join(out)


def d_royal(c):
    out = []
    x, y = vtx(0)
    out.append(crown(x, y - 2, 0.82, '#FFD54F', c['line'], '#D8343F'))
    for k, rot in ((1, 60), (2, 120), (3, 180), (4, 240), (5, 300)):
        x, y = vtx(k)
        out.append(filigree(x, y, 0.95, '#FFE07A', c['line'], rot + 180))
    for k in range(6):
        x, y = edge_mid(k)
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.6" fill="#D8343F" stroke="{c["line"]}" stroke-width="1.2"/>'
                   f'<circle cx="{x - 1:.1f}" cy="{y - 1:.1f}" r="1" fill="#FFFFFF" opacity="0.8"/>')
    return ''.join(out)


def d_starry(c):
    out = []
    x, y = vtx(5)
    out.append(moon(x + 2, y + 1, 10, '#FFE68A', c['line'], c['outer']))
    rnd = random.Random(11)
    band = lerp_poly(OUTER, INNER, 0.42)
    for k in range(6):
        for t in (0.35, 0.75):
            if k == 5 and t > 0.5 or k == 4 and t > 0.6:
                continue
            x, y = mid(band[k], band[(k + 1) % 6], t)
            out.append(star5(x, y, 4.2 + rnd.random() * 1.6, '#FFE68A', c['line'], 1.0, rot=-90 + rnd.random() * 30))
    # 星夜涡旋：外框带上的弧线
    for k in (1, 2, 3):
        a, b = OUTER[k], OUTER[(k + 1) % 6]
        x, y = mid(a, b, 0.5)
        out.append(f'<path d="M{x - 8:.1f},{y:.1f} a6,5 0 1 1 8,4" fill="none" stroke="#9FB2FF" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>')
    return ''.join(out)


DECOR = dict(clover=d_clover, snowline=d_snowline, lily=d_lily, dune=d_dune, neon=d_neon, emperor=d_emperor,
             warbanner=d_warbanner, starlight=d_starlight, royal=d_royal, starry=d_starry)


# ---------- 底板花纹（会被图标盖住，只在空处露出来） ----------
def scatter(seed, n, box=(60, 40, 196, 200)):
    rnd = random.Random(seed)
    return [(rnd.uniform(box[0], box[2]), rnd.uniform(box[1], box[3]), rnd.random()) for _ in range(n)]


def p_clover(c):
    return ''.join(leaf3(x, y, 0.45, '#DDEFC6', '#DDEFC6', r * 120) for x, y, r in scatter(1, 14))


def p_snowline(c):
    return ''.join(snowflake(x, y, 4 + r * 3, '#DCE9F5', 1.1) for x, y, r in scatter(2, 14))


def p_lily(c):
    return ''.join(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{8 + r * 8:.1f}" ry="{3 + r * 3:.1f}" fill="none" stroke="#C3E6DF" stroke-width="1.6"/>' for x, y, r in scatter(3, 11))


def p_dune(c):
    out = []
    for j in range(9):
        y = 50 + j * 18
        out.append(f'<path d="M40,{y} q12,-6 24,0 t24,0 t24,0 t24,0 t24,0 t24,0 t24,0" fill="none" stroke="#F0DCAA" stroke-width="2"/>')
    return ''.join(out)


def p_neon(c):
    out = []
    for j in range(0, 260, 16):
        out.append(f'<path d="M{j},0 L{j},256" stroke="#ADA3E2" stroke-width="1"/><path d="M0,{j} L256,{j}" stroke="#ADA3E2" stroke-width="1"/>')
    out.append(f'<polygon points="{pts(INNER)}" fill="none" stroke="#FF4FD8" stroke-width="5" opacity="0.35" filter="url(#glow)"/>')
    return ''.join(out)


def p_emperor(c):
    return ''.join(gem(x, y, 3.2 + r * 1.5, '#E8DAF4', '#E8DAF4') for x, y, r in scatter(5, 14))


def p_warbanner(c):
    return ''.join(f'<path d="M{j},0 L{j - 120},256" stroke="#F0D6B3" stroke-width="5"/>' for j in range(40, 400, 22))


def p_starlight(c):
    return ''.join(sparkle(x, y, 3 + r * 3, '#F7E7B0') for x, y, r in scatter(6, 16))


def p_royal(c):
    out = []
    for row, y in enumerate(range(50, 210, 26)):
        for x in range(60 + (row % 2) * 16, 210, 32):
            out.append(crown(x, y, 0.32, '#F6E3A6', '#F6E3A6', '#F6E3A6'))
    return ''.join(out)


def p_starry(c):
    out = [f'<defs><linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C6D1F7"/><stop offset="1" stop-color="{c["panel"]}"/></linearGradient></defs>',
           f'<polygon points="{pts(INNER)}" fill="url(#night)"/>']
    for x, y, r in scatter(8, 20):
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{0.9 + r * 1.3:.1f}" fill="#FFFFFF"/>')
    out.append('<path d="M60,90 q20,-18 40,0 t40,0 t40,0" fill="none" stroke="#E7ECFF" stroke-width="3" stroke-linecap="round"/>')
    out.append('<path d="M70,150 q16,-14 32,0 t32,0 t32,0 t32,0" fill="none" stroke="#E7ECFF" stroke-width="3" stroke-linecap="round"/>')
    return ''.join(out)


PATTERN = dict(clover=p_clover, snowline=p_snowline, lily=p_lily, dune=p_dune, neon=p_neon, emperor=p_emperor,
               warbanner=p_warbanner, starlight=p_starlight, royal=p_royal, starry=p_starry)


# ---------- 背景 512x512 ----------
def background_svg(sid, c):
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">{DEFS}'
         f'<rect width="512" height="512" fill="{c["bg"]}"/>']
    R = 52
    w = R * math.sqrt(3)
    rnd = random.Random(sum(map(ord, sid)))
    centers = []
    for row in range(-1, 7):
        for col in range(-1, 6):
            cx = col * (w + 16) + (row % 2) * (w + 16) / 2
            cy = row * (R * 1.5 + 14)
            centers.append((cx, cy))
            hexp = [(cx + R * math.cos(math.radians(60 * k - 90)), cy + R * math.sin(math.radians(60 * k - 90))) for k in range(6)]
            inner = [(cx + (R - 9) * math.cos(math.radians(60 * k - 90)), cy + (R - 9) * math.sin(math.radians(60 * k - 90))) for k in range(6)]
            s.append(f'<polygon points="{pts(hexp)}" fill="{c["outer"]}" stroke="{c["line"]}" stroke-width="3"/>')
            s.append(f'<polygon points="{pts(inner)}" fill="{c["panel"]}" stroke="{c["line"]}" stroke-width="2"/>')
            for k in range(6):
                x, y = hexp[k]
                s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.4" fill="{c["inner"]}"/>')
    # 每款皮肤的标志性小图形，散在格子中央和缝隙里
    for cx, cy in centers:
        s.append(BG_MOTIF[sid](cx, cy, rnd, c))
    s.append('</svg>')
    return ''.join(s)


BG_MOTIF = dict(
    clover=lambda x, y, r, c: leaf3(x, y + 4, 1.0, '#7CC266', c['line'], r.random() * 60),
    snowline=lambda x, y, r, c: snowflake(x, y, 14, c['outer'], 2.6),
    lily=lambda x, y, r, c: lily_pad(x - 6, y + 4, 14, '#5BAA62', c['line'], r.random() * 360) + (lotus(x + 10, y - 4, 0.8, '#F6A9C2', c['line'], '#F7D35A') if r.random() < 0.5 else ''),
    dune=lambda x, y, r, c: (cactus(x, y + 2, 1.1, '#6FAE58', c['line']) if r.random() < 0.4 else f'<path d="M{x - 24:.1f},{y + 4:.1f} q8,-8 16,0 t16,0 t16,0" fill="none" stroke="{c["outer"]}" stroke-width="4" stroke-linecap="round"/>'),
    neon=lambda x, y, r, c: f'<circle cx="{x:.1f}" cy="{y:.1f}" r="16" fill="none" stroke="{"#3FF2FF" if r.random() < 0.5 else "#FF4FD8"}" stroke-width="3" opacity="0.9"/>',
    emperor=lambda x, y, r, c: gem(x, y, 13, ['#5BBF6A', '#5FA8E8', '#F08AB4', '#E9B45A', '#B07BE8'][int(r.random() * 5)], c['line']),
    warbanner=lambda x, y, r, c: shield(x, y, 1.3, '#C23A2E', c['line'], '#F3C449') if r.random() < 0.6 else pennant(x - 8, y - 18, 0.9, '#D2352B', c['line'], '#E7B73F'),
    starlight=lambda x, y, r, c: sparkle(x, y, 12 + r.random() * 6, '#F5D25A', '#FFE070'),
    royal=lambda x, y, r, c: crown(x, y, 1.05, '#F2C443', c['line'], '#D8343F'),
    starry=lambda x, y, r, c: (moon(x, y, 12, '#FFE68A', c['line'], c['panel']) if r.random() < 0.25 else star5(x, y, 11, '#FFE68A', c['line'], 1.6)),
)


# ---------- 合成 ----------
def render(items):
    path = os.path.join(TMP, 'items.json')
    json.dump(items, open(path, 'w'))
    subprocess.run(['node', RENDER, path], check=True, cwd=ROOT)


def rgba(path):
    return np.asarray(Image.open(path).convert('RGBA')).astype(np.float32) / 255.0


def over(dst, src):
    a = src[..., 3:4]
    out = dst.copy()
    out_a = a + dst[..., 3:4] * (1 - a)
    out[..., :3] = np.where(out_a > 1e-6, (src[..., :3] * a + dst[..., :3] * dst[..., 3:4] * (1 - a)) / np.maximum(out_a, 1e-6), 0)
    out[..., 3:4] = out_a
    return out


def hexcolor(s):
    return np.array([int(s[1:3], 16), int(s[3:5], 16), int(s[5:7], 16)], dtype=np.float32)


def gem_region():
    """琥珀边框内侧的六颗金色菱形会伸进底板：找出它们的大致范围"""
    yy, xx = np.mgrid[0:256, 0:256]
    r = (np.abs(xx - 128) <= 14) & ((yy <= 65) | (yy >= 186))
    for vx, vy in (INNER[1], INNER[2], INNER[4], INNER[5]):
        r |= (xx - vx) ** 2 + (yy - vy) ** 2 <= 26 ** 2
    # 底座椭圆里只认菱形自己的金色/红棕描边
    ellipse = ((xx - 127) / 64.0) ** 2 + ((yy - 179) / 16.5) ** 2 <= 1
    return r, ellipse


def gem_pixels(tiles):
    """八个图标格在菱形范围里颜色都一样的像素就是菱形（图标盖住的地方颜色不同，保留）"""
    stack = np.stack([t[..., :3] for t in tiles])
    med = np.median(stack, axis=0)
    region, ellipse = gem_region()
    gold = np.array([234, 185, 78], dtype=np.float32) / 255
    edge = np.array([135, 83, 56], dtype=np.float32) / 255
    d = gold - edge
    out = []
    for t in tiles:
        rgb = t[..., :3]
        same = np.abs(rgb - med).max(axis=-1) < 0.06
        rel = rgb - edge
        k = np.clip((rel @ d) / (d @ d), 0, 1)
        gemish = np.linalg.norm(rel - k[..., None] * d, axis=-1) < 0.09
        out.append(region & same & (~ellipse | gemish))
    return out


def icon_layer(tile, mask, ground, gems=None):
    """从琥珀图标格里抠出图标：底板色（及其与描边的混合）变透明，底座橙色换成皮肤底座色"""
    rgb = tile[..., :3] * 255.0
    P, O = AMBER_PANEL, AMBER_LINE
    d = O - P
    rel = rgb - P
    t = np.clip((rel @ d) / (d @ d), 0, 1)
    perp = np.linalg.norm(rel - t[..., None] * d, axis=-1)
    near = np.linalg.norm(rel, axis=-1)
    w = np.where(near < 18, 1.0, np.where(perp < 22, 1.0 - t, 0.0))  # 底板占比
    w = np.clip(w, 0, 1)
    alpha = (1 - w)
    line = np.where(alpha[..., None] > 1e-3, (rgb - w[..., None] * P) / np.maximum(alpha[..., None], 1e-3), rgb)
    line = np.clip(line, 0, 255)
    # 底座
    g = np.linalg.norm(line - AMBER_GROUND, axis=-1)
    gw = np.clip(1 - g / 40, 0, 1)
    line = line * (1 - gw[..., None]) + ground[None, None, :] * gw[..., None]
    out = np.zeros_like(tile)
    out[..., :3] = line / 255.0
    out[..., 3] = alpha * tile[..., 3] * mask
    if gems is not None:
        out[..., 3] = np.where(gems, 0, out[..., 3])
    return out


def flat(img, colors=256):
    q = img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    return q.convert('RGBA')


def bbox(atlas):
    a = np.asarray(atlas)[..., 3]
    xs0, ys0, xs1, ys1 = 1, 1, 0, 0
    for x, y in POS:
        tile = a[y:y + 256, x:x + 256] > 8
        ys, xs = np.where(tile)
        xs0, ys0 = min(xs0, xs.min() / 256), min(ys0, ys.min() / 256)
        xs1, ys1 = max(xs1, (xs.max() + 1) / 256), max(ys1, (ys.max() + 1) / 256)
    return [round(float(v), 3) for v in (xs0, ys0, xs1, ys1)]


def main():
    ids = [a for a in sys.argv[1:] if a in SKINS] or list(SKINS)
    amber = np.asarray(Image.open(os.path.join(ART, 'atlas_skin_amber.webp')).convert('RGBA')).astype(np.float32) / 255.0
    mask_svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
                f'<polygon points="{pts(lerp_poly(INNER, [(128, 122)] * 6, 0.02))}" fill="#FFFFFF"/></svg>')
    items = [{'svg': mask_svg, 'out': f'{TMP}/mask.png', 'size': 256}]
    for sid in ids:
        c = SKINS[sid]
        items.append({'svg': frame_svg(sid, c), 'out': f'{TMP}/{sid}_frame.png', 'size': 256})
        items.append({'svg': panel_svg(sid, c), 'out': f'{TMP}/{sid}_panel.png', 'size': 256})
        items.append({'svg': background_svg(sid, c), 'out': f'{TMP}/{sid}_bg.png', 'size': 512})
    render(items)
    mask = rgba(f'{TMP}/mask.png')[..., 3]
    hi_json = json.load(open(os.path.join(ART, 'atlas_skin_amber.json'), encoding='utf8'))
    lo_json = json.load(open(os.path.join(ART, 'low', 'atlas_skin_amber.json'), encoding='utf8'))
    boxes = {}
    for sid in ids:
        c = SKINS[sid]
        frame = rgba(f'{TMP}/{sid}_frame.png')
        panel = rgba(f'{TMP}/{sid}_panel.png')
        atlas = np.zeros((520, 1820, 4), dtype=np.float32)
        tiles = [amber[y:y + 256, x:x + 256] for x, y in POS]
        gems = gem_pixels(tiles)
        for (x, y), tile, gem_mask in zip(POS, tiles, gems):
            icon = icon_layer(tile, mask, hexcolor(c['ground']), gem_mask)
            out = np.zeros_like(tile)
            out = over(out, panel)
            out = over(out, icon)
            out = over(out, frame)
            atlas[y:y + 256, x:x + 256] = out
        img = Image.fromarray(np.clip(atlas * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')
        name = f'atlas_skin_{sid}'
        # 调色板 + 无损：平涂画风颜色本来就少，这样抖音包里转成 PNG 也很小
        flat(img).save(os.path.join(ART, f'{name}.webp'), 'WEBP', lossless=True, method=6)
        flat(img.resize((910, 260), Image.LANCZOS)).save(os.path.join(ART, 'low', f'{name}.webp'), 'WEBP', lossless=True, method=6)
        for src, sub in ((hi_json, ''), (lo_json, 'low')):
            j = copy.deepcopy(src)
            j['name'] = name
            for page in j['pages']:
                page['image'] = f'{name}.webp'
                if 'png' in page:
                    page['png'] = f'png/atlases/{name}.png'
            with open(os.path.join(ART, sub, f'{name}.json'), 'w', encoding='utf8') as f:
                json.dump(j, f, ensure_ascii=False, indent=2)
                f.write('\n')
        bg = Image.open(f'{TMP}/{sid}_bg.png').convert('RGB')
        flat(bg, 96).convert('RGB').save(os.path.join(ART, f'skin_background_{sid}.webp'), 'WEBP', lossless=True, method=6)
        boxes[sid] = bbox(img)
        print(sid, boxes[sid])
    json.dump(boxes, open(os.path.join(TMP, 'boxes.json'), 'w'))
    print('boxes', json.dumps(boxes))


if __name__ == '__main__':
    main()
