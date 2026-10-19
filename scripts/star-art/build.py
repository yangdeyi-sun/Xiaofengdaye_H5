"""生成明星蜂美术：与原蜜蜂同一套画风，原来的可爱形象一点不变。

- atlas_star_wings_<工种>：金色翅膀叠加层（只把翅膀像素换成金色）
- atlas_star_<特性>：跟随头部摆动的特性配饰叠加层（accessories.py 里的 SVG）
  两者与对应工种图集 atlas_bees_<工种> 的页尺寸、帧位置、动画完全一致，
  运行时先画原蜜蜂，再用同一帧画叠加层。
- bee_<工种>.webp / star_<特性>.webp：信息卡、名册、图鉴用的头像

用法（项目根目录）：python scripts/star-art/build.py [输出目录，默认 public/art/v1] [--portraits 只重做头像]
依赖：Python 3 + Pillow + numpy + scipy；Node（npm install 后的 @resvg/resvg-js）
"""
import json, math, os, subprocess, sys, copy, tempfile
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from accessories import ACC, ROLE
from eyes import SRC, load, frame_arr, eyes, lenses

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
PORTRAITS_ONLY = '--portraits' in sys.argv
OUT = ARGS[0] if ARGS else SRC
os.makedirs(os.path.join(OUT, 'low'), exist_ok=True)
TMP = tempfile.mkdtemp(prefix='star-art-')
FIRST = {'forager': 'fly_00', 'scout': 'idle_00', 'house': 'idle_00', 'guard': 'patrol_00'}

items = [{'svg': v, 'out': f'{TMP}/acc_{k}.png', 'size': 512} for k, v in ACC.items()]
json.dump(items, open(f'{TMP}/items.json', 'w'))
subprocess.run(['node', os.path.join(HERE, 'render.mjs'), f'{TMP}/items.json'], check=True)


def pose(a, role):
    e = lenses(a) if role == 'scout' else eyes(a)
    if e is None:
        return None
    l, r = e
    mx, my = (l[0] + r[0]) / 2, (l[1] + r[1]) / 2
    return mx, my, math.atan2(r[1] - l[1], r[0] - l[0])


def gold_wings(a):
    f = a.astype(np.float32)
    r, g, b, al = f[..., 0], f[..., 1], f[..., 2], f[..., 3]
    wing = (al > 8) & (al < 248) & (g >= r - 4) & (g > 170) & (b > 150) & (r > 150) & (b <= g + 4)
    out = np.zeros_like(f)
    out[..., 0] = np.clip(r * 1.02 + 8, 0, 255)
    out[..., 1] = np.clip(g * 0.93, 0, 255)
    out[..., 2] = np.clip(b * 0.62, 0, 255)
    out[..., 3] = al
    out[~wing] = 0
    return out.astype(np.uint8)


def place(acc2x, ref, cur):
    """把参考姿势下画好的配饰（2 倍分辨率）摆到当前帧的头部位置与角度"""
    rx, ry, ra = ref
    cx, cy, ca = cur
    d = ca - ra
    cos, sin = math.cos(-d), math.sin(-d)
    # 输出像素 q（2 倍坐标）→ 输入像素 p：p = R(-d)(q - 2*cur) + 2*ref
    a, b = cos, -sin
    c = 2 * rx - (a * 2 * cx + b * 2 * cy)
    dd, e = sin, cos
    f = 2 * ry - (dd * 2 * cx + e * 2 * cy)
    moved = acc2x.transform((512, 512), Image.AFFINE, (a, b, c, dd, e, f), resample=Image.BICUBIC)
    return moved.resize((256, 256), Image.LANCZOS)


def half(v):
    return v / 2 if isinstance(v, float) or v % 2 else v // 2


def low_meta(meta):
    """半尺寸版本的图集描述（与 public/art/v1/low 里其它图集一致）"""
    low = copy.deepcopy(meta)
    for p in low['pages']:
        p.pop('png', None)
        p['size'] = {'w': p['size']['w'] // 2, 'h': p['size']['h'] // 2}
        p['decodedBytes'] = p['size']['w'] * p['size']['h'] * 4
    for fr in low['frames'].values():
        for key in ('frame', 'spriteSourceSize', 'sourceSize', 'hitArea'):
            if key in fr:
                fr[key] = {k: half(v) for k, v in fr[key].items()}
        if 'pivot' in fr and isinstance(fr['pivot'], dict) and max(fr['pivot'].values()) > 1:
            fr['pivot'] = {k: half(v) for k, v in fr['pivot'].items()}
    low['meta']['scale'] = 1
    low['meta']['padding'] = 1
    low['meta']['source'] = '128px downsample of ' + meta['meta']['source']
    return low


def save_atlas(name, d, out_pages, source):
    meta = copy.deepcopy(d)
    meta['name'] = name
    meta['id'] = name.upper()
    meta['meta']['source'] = source
    sizes = []
    for i, im in enumerate(out_pages):
        suffix = f'_{i}' if len(out_pages) > 1 else ''
        meta['pages'][i]['image'] = f'{name}{suffix}.webp'
        meta['pages'][i]['png'] = f'png/atlases/{name}{suffix}.png'
        im.save(os.path.join(OUT, f'{name}{suffix}.webp'), 'WEBP', lossless=True, quality=100, method=6)
        low_path = os.path.join(OUT, 'low', f'{name}{suffix}.webp')
        im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(low_path, 'WEBP', lossless=True, quality=100, method=6)
        sizes.append(os.path.getsize(low_path))
    json.dump(meta, open(os.path.join(OUT, f'{name}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(low_meta(meta), open(os.path.join(OUT, 'low', f'{name}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return sizes


report = {}


def build_atlases():
    poses = {}
    for role in FIRST:
        base_name = f'atlas_bees_{role}'
        d, pages = load(base_name)
        ref = pose(frame_arr(d, pages, FIRST[role]), role)
        out_pages = [Image.new('RGBA', (p.shape[1], p.shape[0]), (0, 0, 0, 0)) for p in pages]
        last = ref
        per = {}
        for key, fr in d['frames'].items():
            b = fr['frame']
            a = frame_arr(d, pages, key)
            cur = pose(a, role) or last
            last = cur
            per[key] = cur
            out_pages[fr.get('page', 0)].alpha_composite(Image.fromarray(gold_wings(a)), (b['x'], b['y']))
        poses[role] = (ref, per)
        report[f'wings_{role}'] = save_atlas(f'atlas_star_wings_{role}', d, out_pages, f'{base_name} 同帧叠加层：明星蜂金色翅膀（scripts/star-art）')

    for trait, role in ROLE.items():
        base_name = f'atlas_bees_{role}'
        d, pages = load(base_name)
        acc2x = Image.open(f'{TMP}/acc_{trait}.png').convert('RGBA')
        ref, per = poses[role]
        out_pages = [Image.new('RGBA', (p.shape[1], p.shape[0]), (0, 0, 0, 0)) for p in pages]
        for key, fr in d['frames'].items():
            b = fr['frame']
            out_pages[fr.get('page', 0)].alpha_composite(place(acc2x, ref, per[key]), (b['x'], b['y']))
        report[trait] = save_atlas(f'atlas_star_{trait}', d, out_pages, f'{base_name} 同帧叠加层：明星蜂「{trait}」配饰（scripts/star-art）')



if not PORTRAITS_ONLY:
    build_atlases()

# 头像：普通工种 + 明星蜂各一张，信息卡、名册、图鉴使用。
# 同一工种的头像用同一个取景框（原蜜蜂 + 三种配饰的并集），名册里普通蜂和明星蜂大小一致。
def portrait_box(boxes):
    x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
    cx = (x0 + x1) / 2
    side = max(x1 - x0, y1 - y0) + 8
    top = max(0, y0 - 4)
    return (int(cx - side / 2), top, int(cx + side / 2), top + side)


def base_frame(role):
    d, pages = load(f'atlas_bees_{role}')
    a = frame_arr(d, pages, FIRST[role]).copy()
    a[200:, :] = 0  # 去掉地面阴影
    return a


for role in FIRST:
    a = base_frame(role)
    base = Image.fromarray(a)
    traits = [t for t, r in ROLE.items() if r == role]
    stars = {}
    for trait in traits:
        im = base.copy()
        im.alpha_composite(Image.fromarray(gold_wings(a)))
        im.alpha_composite(Image.open(f'{TMP}/acc_{trait}.png').resize((256, 256), Image.LANCZOS))
        stars[trait] = im
    box = portrait_box([base.getbbox()] + [im.getbbox() for im in stars.values()])
    base.crop(box).resize((160, 160), Image.LANCZOS).save(os.path.join(OUT, f'bee_{role}.webp'), 'WEBP', quality=90, alpha_quality=100, method=6)
    for trait, im in stars.items():
        im.crop(box).resize((160, 160), Image.LANCZOS).save(os.path.join(OUT, f'star_{trait}.webp'), 'WEBP', quality=90, alpha_quality=100, method=6)
print(json.dumps(report))
